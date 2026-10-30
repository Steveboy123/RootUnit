import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { ACTION_LIMITS, ID_RE, sanitizeQuickAction, type QuickActionDef, type QuickActionPublic } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const FILE = 'actions.json';
const TIMEOUT_MS = 5000;

export type AddressKind = 'loopback' | 'private' | 'linklocal' | 'public' | 'invalid';

/** What kind of network an IP address is on. */
export function classifyAddress(address: string): AddressKind {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    if (a === 127) return 'loopback';
    if (a === 0 || a >= 224) return 'invalid';
    if (a === 169 && b === 254) return 'linklocal';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'private';
    return 'public';
  }
  if (family === 6) {
    const v = address.toLowerCase();
    if (v === '::1') return 'loopback';
    if (v === '::') return 'invalid';
    if (v.startsWith('::ffff:') && isIP(v.slice(7)) === 4) return classifyAddress(v.slice(7));
    const first = parseInt(v.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return 'private';
    if ((first & 0xffc0) === 0xfe80) return 'linklocal';
    if ((first & 0xff00) === 0xff00) return 'invalid';
    return 'public';
  }
  return 'invalid';
}

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export interface ActionsOptions {
  fetch?: typeof fetch;
  resolve?: Resolver;
  newId?: () => string;
}

interface Saved {
  /** Let actions reach addresses on the internet (a cloud webhook, Home Assistant Cloud). Off: only this car's own network. */
  allowInternet: boolean;
  items: QuickActionDef[];
}

const toPublic = (a: QuickActionDef): QuickActionPublic => ({ id: a.id, name: a.name, icon: a.icon, confirm: a.confirm });

/**
 * Buttons that call a web address: a garage door, a Home Assistant webhook, a light. The server makes the call (a browser would be
 * blocked by CORS), and refuses to be turned into a way to reach things it should not: addresses are checked after DNS, redirects are
 * never followed, and by default only the car's own network is reachable. The address itself, which may carry a secret, is never
 * broadcast to the screens; only the name and icon are.
 */
export class QuickActions {
  readonly state = new Observable<QuickActionPublic[]>([]);
  private saved: Saved = { allowInternet: false, items: [] };
  private readonly f: typeof fetch;
  private readonly resolve: Resolver;
  private readonly newId: () => string;

  constructor(
    private store: JsonStore,
    opts: ActionsOptions = {},
  ) {
    this.f = opts.fetch ?? fetch;
    this.resolve = opts.resolve ?? systemResolver;
    this.newId = opts.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));
  }

  async start(): Promise<void> {
    const raw = (await this.store.read(FILE)) as Partial<Saved> | null;
    const items: QuickActionDef[] = [];
    for (const r of Array.isArray(raw?.items) ? raw.items : []) {
      const a = sanitizeQuickAction(r);
      if (a) items.push({ ...a, id: typeof (r as { id?: unknown }).id === 'string' && ID_RE.test((r as { id: string }).id) ? (r as { id: string }).id : this.newId() });
    }
    this.saved = { allowInternet: raw?.allowInternet === true, items: items.slice(0, ACTION_LIMITS.max) };
    this.publish();
  }

  /** Full definitions, addresses included, for the editor only. */
  config(): Saved {
    return { allowInternet: this.saved.allowInternet, items: this.saved.items };
  }

  /** Replace the whole list from the editor. Items that name an existing id keep it, so a rename does not lose the button's place. */
  async replace(input: unknown): Promise<void> {
    const body = (typeof input === 'object' && input !== null ? input : {}) as { allowInternet?: unknown; items?: unknown };
    if (!Array.isArray(body.items)) throw new ActionError('Send the list of actions.');
    if (body.items.length > ACTION_LIMITS.max) throw new ActionError(`At most ${ACTION_LIMITS.max} actions.`);
    const known = new Set(this.saved.items.map((i) => i.id));
    const items: QuickActionDef[] = [];
    for (const [i, r] of body.items.entries()) {
      const a = sanitizeQuickAction(r);
      if (!a) throw new ActionError(`Action ${i + 1} needs a name and a web address starting with http:// or https://.`);
      const given = (r as { id?: unknown }).id;
      items.push({ ...a, id: typeof given === 'string' && known.has(given) ? given : this.newId() });
    }
    this.saved = { allowInternet: body.allowInternet === true, items };
    await this.store.writeOrThrow(FILE, this.saved);
    this.publish();
  }

  /** Check where an address leads. Throws a plain-language reason when it must not be called. */
  async check(url: string): Promise<void> {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await this.resolve(host);
    } catch {
      throw new ActionError(`Could not find "${host}" on the network.`, 502);
    }
    if (addresses.length === 0) throw new ActionError(`Could not find "${host}" on the network.`, 502);
    for (const a of addresses) {
      const kind = classifyAddress(a);
      if (kind === 'linklocal' || kind === 'invalid') throw new ActionError('That address is not allowed.', 403);
      if (kind === 'public' && !this.saved.allowInternet) throw new ActionError('That address is on the internet. Switch on "Allow the internet" in the Quick actions editor to call it.', 403);
    }
  }

  async run(id: string): Promise<{ ok: boolean; status: number | null; message: string }> {
    const a = this.saved.items.find((i) => i.id === id);
    if (!a) throw new ActionError('That action no longer exists.', 404);
    await this.check(a.url);
    try {
      const r = await this.f(a.url, {
        method: a.method,
        redirect: 'manual', // a redirect could lead somewhere the check above never saw
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'RPI-Head-Unit/2.0', ...(a.method === 'POST' && a.body ? { 'Content-Type': looksLikeJson(a.body) ? 'application/json' : 'text/plain' } : {}) },
        ...(a.method === 'POST' && a.body ? { body: a.body } : {}),
      });
      // Only the status goes back to the screen: the response body is not ours to show or store.
      const ok = r.status >= 200 && r.status < 400;
      return { ok, status: r.status, message: ok ? 'Done' : `The device answered ${r.status}.` };
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return { ok: false, status: null, message: timedOut ? 'No answer within 5 seconds.' : 'Could not reach it.' };
    }
  }

  private publish(): void {
    this.state.set(this.saved.items.map(toPublic));
  }
}

function looksLikeJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
