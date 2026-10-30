import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { FM_PROTOCOL } from '@headunit/shared';
import { vi } from 'vitest';
import type { JsonStore } from '../../store';
import type { ConnectFn, SpawnFn } from '../capture';

/** A password that looks like a real one. Tests look for it in every state, error and log line. */
export const TOKEN = 'tok_0123456789abcdefSECRETvalue';
export const BASE_URL = 'http://192.168.1.50:8788';

/** A store that lives in memory: reads what was put in, remembers every write. */
export class MemStore {
  files = new Map<string, unknown>();
  writes: Array<{ name: string; value: unknown }> = [];

  async read(name: string): Promise<unknown | null> {
    return this.files.has(name) ? JSON.parse(JSON.stringify(this.files.get(name))) : null;
  }

  async write(name: string, value: unknown): Promise<void> {
    const copy = JSON.parse(JSON.stringify(value));
    this.files.set(name, copy);
    this.writes.push({ name, value: copy });
  }

  async flush(): Promise<void> {}

  asStore(): JsonStore {
    return this as unknown as JsonStore;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The helper's control side (HTTP), as a fetch.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface FakeNodeState {
  protocol: number;
  version: string;
  board: string | null;
  supported: boolean;
  reason: string | null;
  state: 'idle' | 'transmitting' | 'error';
  frequency: number | null;
  bandwidth: number | null;
  audio: { connected: boolean; level: number; underruns: number };
  error: string | null;
  limits: { min: number; max: number; maxBandwidth: number };
  deadmanS: number;
}

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

export type HelperMode = 'normal' | 'down' | 'hang' | 'html' | 'garbage' | 'error500' | 'huge' | 'redirect';

/** An FM helper's HTTP side, in memory. Keeps the books of what it was asked, and does what the real one does with a good request. */
export class FakeHelper {
  mode: HelperMode = 'normal';
  token = TOKEN;
  node: FakeNodeState = {
    protocol: FM_PROTOCOL,
    version: '1.0.0',
    board: 'Raspberry Pi 4 Model B Rev 1.4',
    supported: true,
    reason: null,
    state: 'idle',
    frequency: null,
    bandwidth: null,
    audio: { connected: false, level: 0, underruns: 0 },
    error: null,
    limits: { min: 87.5, max: 108, maxBandwidth: 150 },
    deadmanS: 30,
  };
  calls: RecordedCall[] = [];
  /** Answer to the next `POST /v1/start`: replaces the normal behaviour once. */
  nextStart: { status: number; body: unknown } | null = null;
  /** How long an answer takes (ms of the fake clock), and how long one to `POST /v1/start` takes in addition. */
  delayMs = 0;
  startDelayMs = 0;
  /** Every start is accepted but the transmitter program then fails with this message (the helper's state becomes `error`). */
  programFails: string | null = null;
  /** Every start is accepted but the carrier does not come up (the state stays `idle`). */
  stuckIdle = false;
  /** Requests not yet answered, and a way to see that a request was cancelled. */
  inFlight = 0;
  maxInFlight = 0;
  aborted = 0;

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    this.calls.push({ method, path: url.pathname, headers, body, at: Date.now() });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.wait(init?.signal ?? undefined);
      if (this.startDelayMs > 0 && method === 'POST' && url.pathname === '/v1/start') await this.wait(init?.signal ?? undefined, this.startDelayMs);
      return this.answer(method, url.pathname, headers, body);
    } finally {
      this.inFlight--;
    }
  };

  /** Calls to one endpoint, in order. */
  to(method: string, path: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  private wait(signal?: AbortSignal, ms = this.delayMs): Promise<void> {
    if (this.mode === 'down') return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', message: `connect ECONNREFUSED 192.168.1.50:8788 ${this.token}` } }));
    const hang = this.mode === 'hang';
    if (!hang && ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const t = hang ? null : setTimeout(resolve, ms);
      const onAbort = () => {
        if (t) clearTimeout(t);
        this.aborted++;
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private answer(method: string, path: string, headers: Record<string, string>, body: unknown): Response {
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (this.mode === 'html') return new Response('<html>router login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (this.mode === 'garbage') return new Response('{"hello":"world"}', { status: 200 });
    if (this.mode === 'error500') return new Response('boom', { status: 500 });
    if (this.mode === 'huge') return new Response('x'.repeat(200_000), { status: 200 });
    if (this.mode === 'redirect') throw new TypeError('fetch failed');
    if (headers.authorization !== `Bearer ${this.token}`) return json(401, { error: 'Wrong password.' });
    if (method === 'GET' && path === '/v1/status') return json(200, this.node);
    if (method === 'POST' && path === '/v1/start') {
      if (this.nextStart) {
        const r = this.nextStart;
        this.nextStart = null;
        return json(r.status, r.body);
      }
      if (!this.node.supported) return json(403, { error: this.node.reason ?? 'This board is not supported.' });
      const b = (body ?? {}) as { frequency?: unknown; bandwidth?: unknown };
      if (typeof b.frequency !== 'number' || b.frequency < this.node.limits.min || b.frequency > this.node.limits.max) return json(400, { error: 'The frequency is outside the allowed band.' });
      if (typeof b.bandwidth !== 'number' || b.bandwidth < 25 || b.bandwidth > this.node.limits.maxBandwidth) return json(400, { error: 'The bandwidth is outside 25 to the maximum.' });
      if (this.programFails) {
        this.node.state = 'error';
        this.node.frequency = null;
        this.node.bandwidth = null;
        this.node.error = this.programFails;
        return json(200, this.node);
      }
      this.node.state = this.stuckIdle ? 'idle' : 'transmitting';
      this.node.frequency = this.stuckIdle ? null : b.frequency;
      this.node.bandwidth = this.stuckIdle ? null : b.bandwidth;
      this.node.error = null;
      return json(200, this.node);
    }
    if (method === 'POST' && path === '/v1/stop') {
      this.node.state = 'idle';
      this.node.frequency = null;
      this.node.bandwidth = null;
      this.node.audio = { connected: false, level: 0, underruns: 0 };
      return json(200, this.node);
    }
    return json(404, { error: 'Not found.' });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// parec and the sound connection.
// ---------------------------------------------------------------------------------------------------------------------------------

export class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];
  /** SIGTERM does nothing (a parec that will not end). */
  ignoreTerm = false;

  constructor(
    readonly command: string,
    readonly args: string[],
  ) {
    super();
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (signal === 'SIGTERM' && this.ignoreTerm) return true;
    queueMicrotask(() => this.exit(null, signal));
    return true;
  }

  spawned(): void {
    this.emit('spawn');
  }

  sound(bytes: Buffer): void {
    this.stdout.emit('data', bytes);
  }

  say(text: string): void {
    this.stderr.emit('data', Buffer.from(text));
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = signal ? null : (code ?? 0);
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  /** What Node does when the program does not exist: no pid, an 'error' event, never a 'spawn'. */
  enoent(): void {
    this.pid = undefined;
    this.emit('error', Object.assign(new Error('spawn parec ENOENT'), { code: 'ENOENT', errno: -2, syscall: 'spawn parec', path: 'parec' }));
  }
}

export class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  /** What `write` returns: false makes the pump wait for 'drain'. */
  accepting = true;
  noDelay = false;

  constructor(
    readonly port: number,
    readonly host: string,
  ) {
    super();
  }

  setNoDelay(on: boolean): this {
    this.noDelay = on;
    return this;
  }

  write(data: Buffer | string): boolean {
    if (this.destroyed) return false;
    this.written.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return this.accepting;
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    queueMicrotask(() => this.emit('close', false));
    return this;
  }

  // ---- the other end ----
  connected(): void {
    this.emit('connect');
  }

  reply(text: string): void {
    this.emit('data', Buffer.from(text, 'latin1'));
  }

  failWith(code: string): void {
    this.emit('error', Object.assign(new Error(`connect ${code} 192.168.1.50:8789 ${TOKEN}`), { code }));
  }

  peerCloses(): void {
    this.emit('close', false);
  }

  drain(): void {
    this.accepting = true;
    this.emit('drain');
  }

  /** The first line the pump sent ("AUDIO 1 <password>"), without the newline. */
  get firstLine(): string {
    return (this.written[0] ?? Buffer.alloc(0)).toString('latin1').replace(/\n$/, '');
  }

  /** Everything after the first line, as one buffer. */
  get sound(): Buffer {
    return Buffer.concat(this.written.slice(1));
  }
}

/** parec and the audio connection of the head unit, both fake. Everything it was asked to start is kept, newest last. */
export class FakeNet {
  children: FakeChild[] = [];
  sockets: FakeSocket[] = [];
  /** 'auto': spawn and connect by themselves, and the helper says OK. A string: its answer. null: the test drives it. */
  auto: 'ok' | string | null = null;
  /** The program is missing (ENOENT). */
  missingParec = false;
  /** Called when a sound connection is accepted, so that a fake helper can say "audio connected". */
  onAccepted: ((socket: FakeSocket) => void) | null = null;

  spawn: SpawnFn = (command, args) => {
    const child = new FakeChild(command, args);
    this.children.push(child);
    queueMicrotask(() => {
      if (this.missingParec) child.enoent();
      else if (this.auto !== null) child.spawned();
    });
    return child as unknown as ChildProcess;
  };

  connect: ConnectFn = (port, host) => {
    const socket = new FakeSocket(port, host);
    this.sockets.push(socket);
    if (this.auto !== null) {
      queueMicrotask(() => {
        socket.connected();
        queueMicrotask(() => {
          if (this.auto === 'ok') {
            socket.reply('OK\n');
            this.onAccepted?.(socket);
          } else if (this.auto) socket.reply(`${this.auto}\n`);
        });
      });
    }
    return socket as unknown as Socket;
  };

  get child(): FakeChild {
    return this.children[this.children.length - 1]!;
  }

  get socket(): FakeSocket {
    return this.sockets[this.sockets.length - 1]!;
  }

  /** Children not yet ended and sockets not yet destroyed: what would be left behind. */
  get leftBehind(): number {
    return this.children.filter((c) => c.exitCode === null && c.signalCode === null && c.pid !== undefined).length + this.sockets.filter((s) => !s.destroyed).length;
  }
}

/** Wait (real time) until a check passes: for the tests that use real sockets and processes. */
export const until = (check: () => unknown, timeout = 10_000): Promise<void> => vi.waitFor(check, { timeout, interval: 20 }) as Promise<void>;

/** Run the fake clock and the promises it releases for `ms`. */
export const sleepFor = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

/** Console output of one test, so that it can be searched for secrets. */
export function captureConsole(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(grab));
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}
