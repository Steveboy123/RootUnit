import { parseFmNodeStatus, type FmNodeStatus } from '@headunit/shared';
import type { FmSecret } from './config';

/** What came back from the FM helper. A request never throws: every way it can go wrong is one of these. */
export type FmNodeReply =
  | { kind: 'ok'; status: FmNodeStatus }
  /** Nothing answered (refused, timed out, redirected, no route) or the server failed. `why` is a short fixed phrase, never an address. */
  | { kind: 'unreachable'; why: string }
  /** Something answered, but not like the FM helper does. */
  | { kind: 'notahelper'; why: string }
  /** 401: the password does not match. */
  | { kind: 'unauthorized' }
  /** 400, 403 or 409 from `start`: the helper understood and said no, in a sentence of its own. */
  | { kind: 'refused'; code: number; message: string };

export interface FmClientOptions {
  /** `http://host:port`. */
  baseUrl: string;
  token: FmSecret;
  fetch?: typeof fetch;
}

const STATUS_TIMEOUT_MS = 3000;
/** A real answer is a few hundred bytes. Anything bigger is not the helper and is not read to the end. */
const MAX_BODY_BYTES = 16 * 1024;

const clean = (v: unknown, max: number): string => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const REFUSED_DEFAULT: Record<number, string> = {
  400: 'The FM helper did not accept that frequency.',
  403: 'The FM helper cannot transmit on this board.',
  409: 'The transmitter program just failed to start; the FM helper is waiting a few seconds before it tries again.',
};

/** The control side of the helper's protocol (`GET /v1/status`, `POST /v1/start`, `POST /v1/stop`), as plain functions over `fetch`. */
export class FmNodeClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: FmClientOptions) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  status(signal?: AbortSignal): Promise<FmNodeReply> {
    return this.call('GET', '/v1/status', undefined, STATUS_TIMEOUT_MS, signal);
  }

  /** Transmit on `frequency` (MHz), or retune when it already is. */
  start(frequency: number, bandwidth: number, signal?: AbortSignal): Promise<FmNodeReply> {
    return this.call('POST', '/v1/start', { frequency, bandwidth }, STATUS_TIMEOUT_MS, signal);
  }

  /** Carrier off. `timeoutMs` is short at shutdown, when nobody can wait. */
  stop(timeoutMs = STATUS_TIMEOUT_MS, signal?: AbortSignal): Promise<FmNodeReply> {
    return this.call('POST', '/v1/stop', {}, timeoutMs, signal);
  }

  private async call(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number, outer?: AbortSignal): Promise<FmNodeReply> {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    timer.unref?.();
    const onOuter = () => ctl.abort();
    if (outer?.aborted) ctl.abort();
    else outer?.addEventListener('abort', onOuter, { once: true });
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.opts.token.reveal()}`,
        Accept: 'application/json',
        // One request per connection: nothing idle is left open between polls, and an old connection can never be reused after the helper restarts.
        Connection: 'close',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await this.fetchFn(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // A redirect would send the password on to another address.
        redirect: 'error',
        cache: 'no-store',
        signal: ctl.signal,
      });
      const text = await readBounded(res, MAX_BODY_BYTES);
      return interpret(method, path, res.status, text);
    } catch (err) {
      return { kind: 'unreachable', why: timedOut ? 'did not answer in time' : outer?.aborted ? 'cancelled' : reasonOf(err) };
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    }
  }
}

function interpret(method: string, path: string, status: number, text: string | null): FmNodeReply {
  if (status === 401) return { kind: 'unauthorized' };
  if (status >= 500) return { kind: 'unreachable', why: `error ${status}` };
  if (status >= 200 && status < 300) {
    if (text === null) return { kind: 'notahelper', why: 'answer too long' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'notahelper', why: 'not JSON' };
    }
    const parsedStatus = parseFmNodeStatus(parsed);
    return parsedStatus ? { kind: 'ok', status: parsedStatus } : { kind: 'notahelper', why: 'not a helper answer' };
  }
  if (method === 'POST' && path === '/v1/start' && (status === 400 || status === 403 || status === 409)) {
    let message = '';
    try {
      const err = (JSON.parse(text ?? '') as { error?: unknown }).error;
      if (typeof err === 'string') message = clean(err, 200);
    } catch {
      // not a helper's JSON: the default sentence below is used
    }
    return { kind: 'refused', code: status, message: message || (REFUSED_DEFAULT[status] ?? 'The FM helper refused that.') };
  }
  return { kind: 'notahelper', why: `answer ${status}` };
}

/** The body as text, or null when it is longer than `max` bytes (it is cancelled at that point, not read on). */
async function readBounded(res: Response, max: number): Promise<string | null> {
  if (!res.body) return await res.text().then((t) => (t.length > max ? null : t));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A short fixed phrase for a failed request. Never the library's own message: that can carry the address. */
function reasonOf(err: unknown): string {
  // fetch wraps the real error as `cause`; a host with both IPv4 and IPv6 addresses wraps several as `errors`.
  const queue: unknown[] = [err];
  for (let seen = 0; queue.length > 0 && seen < 8; seen++) {
    const e = queue.shift();
    if (!e || typeof e !== 'object') continue;
    switch ((e as { code?: unknown }).code) {
      case 'ECONNREFUSED':
        return 'connection refused';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'unknown name';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'no route';
      case 'ECONNRESET':
      case 'UND_ERR_SOCKET':
        return 'connection dropped';
      case 'ETIMEDOUT':
      case 'UND_ERR_CONNECT_TIMEOUT':
        return 'did not answer in time';
    }
    queue.push((e as { cause?: unknown }).cause);
    const errors = (e as { errors?: unknown }).errors;
    if (Array.isArray(errors)) queue.push(...errors.slice(0, 2));
  }
  return 'no answer';
}
