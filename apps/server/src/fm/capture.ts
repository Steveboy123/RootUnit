import type { ChildProcess } from 'node:child_process';
import type { Socket } from 'node:net';
import { FM_CHANNELS, FM_PROTOCOL, FM_SAMPLE_RATE } from '@headunit/shared';
import type { FmSecret } from './config';

export type SpawnFn = (command: string, args: string[]) => ChildProcess;
export type ConnectFn = (port: number, host: string) => Socket;

/** Why a sound connection ended. Texts here are fixed phrases or the helper's own sentence: never an address, never the password. */
export type PumpFailure =
  | { kind: 'missing-parec' }
  /** parec started and then stopped (no sound server running, a wrong source name ...). `message` is the last line it printed. */
  | { kind: 'capture'; message: string }
  | { kind: 'connect'; message: string }
  /** The helper answered `ERR <reason>` to the first line. */
  | { kind: 'refused'; message: string }
  | { kind: 'timeout' }
  /** The helper closed the connection, or stopped taking the sound. Another head unit connecting replaces this one: that looks like this. */
  | { kind: 'closed'; message: string };

export type PumpPhase = 'new' | 'connecting' | 'streaming' | 'down';

export interface PumpOptions {
  /** parec's `--device=`. */
  source: string;
  host: string;
  port: number;
  token: FmSecret;
  spawn: SpawnFn;
  connect: ConnectFn;
  /** The recorder program. Only ever parec; a parameter so that a test can point at a stand-in. */
  command?: string;
  onStreaming(): void;
  /** Called once, when the connection ends by itself. Not called after `stop()`. */
  onDown(failure: PumpFailure): void;
  /** Time allowed to start parec and open the connection. */
  connectTimeoutMs?: number;
  /** Time allowed for the helper's `OK` after the first line. */
  handshakeMs?: number;
  /** How much sound may wait for the connection, in bytes. Beyond it the oldest is thrown away. */
  maxBehindBytes?: number;
  /** A connection that takes no more sound for this long is given up. */
  stallMs?: number;
  /** After SIGTERM, SIGKILL. */
  killAfterMs?: number;
}

/** One second of what parec records (S16LE mono). The sound may be this far behind before the oldest is dropped. */
export const DEFAULT_MAX_BEHIND_BYTES = FM_SAMPLE_RATE * FM_CHANNELS * 2;

export const parecArgs = (source: string): string[] => [`--device=${source}`, '--raw', `--rate=${FM_SAMPLE_RATE}`, `--channels=${FM_CHANNELS}`, '--format=s16le', '--latency-msec=50'];

const clean = (v: unknown, max: number): string => String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A short fixed phrase for a socket error. Not the library's message: it contains the address. */
function socketReason(err: unknown): string {
  switch ((err as NodeJS.ErrnoException | undefined)?.code) {
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'connection dropped';
    case 'ETIMEDOUT':
      return 'did not answer in time';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'no route';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'unknown name';
    default:
      return 'no answer';
  }
}

/**
 * The head unit's sound on its way to the FM helper: parec records what the head unit plays, and every byte of it goes down one TCP
 * connection that starts with `AUDIO 1 <password>`. One instance is one attempt; when it ends (for any reason) it is finished and the
 * owner makes a new one after a pause.
 *
 * The sound never waits for a slow connection: more than about a second behind, the oldest is thrown away, so memory stays flat and the
 * delay does not grow. Pieces are kept a whole number of samples long, so throwing one away can never shift the rest by a byte (which
 * would turn the sound into noise).
 */
export class CapturePump {
  phase: PumpPhase = 'new';
  /** Bytes thrown away because the connection was too slow. */
  droppedBytes = 0;
  /** Bytes handed to the connection. */
  sentBytes = 0;

  private child: ChildProcess | null = null;
  private socket: Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stallTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private waitingDrain = false;
  private queue: Buffer[] = [];
  private queued = 0;
  private carry: Buffer | null = null;
  private reply = '';
  private stderrTail = '';

  constructor(private readonly opts: PumpOptions) {}

  /** Bytes waiting for the connection right now. */
  get backlog(): number {
    return this.queued;
  }

  start(): void {
    if (this.phase !== 'new') return;
    this.phase = 'connecting';
    const { opts } = this;
    let child: ChildProcess;
    try {
      child = opts.spawn(opts.command ?? 'parec', parecArgs(opts.source));
    } catch (err) {
      this.fail((err as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'missing-parec' } : { kind: 'capture', message: 'Sound capture (parec) could not be started.' });
      return;
    }
    this.child = child;
    child.stdout?.on('data', (c: Buffer) => this.onSound(c));
    child.stderr?.on('data', (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString('utf8')).slice(-400);
    });
    // A read error on a pipe is the end of parec; the 'exit' below says so. Unhandled, it would be an uncaught exception.
    child.stdout?.on('error', () => undefined);
    child.stderr?.on('error', () => undefined);
    child.on('error', (err: NodeJS.ErrnoException) => this.fail(err?.code === 'ENOENT' ? { kind: 'missing-parec' } : { kind: 'capture', message: 'Sound capture (parec) could not be started.' }));
    child.on('exit', () => {
      const last = this.stderrTail.split('\n').map((l) => clean(l, 160)).filter(Boolean).pop();
      this.fail({ kind: 'capture', message: last ? `parec stopped: ${last}` : 'parec stopped.' });
    });
    // The password is not sent anywhere until parec is known to run: a head unit without parec never touches the network for this.
    child.once('spawn', () => this.openSocket());
    this.arm(opts.connectTimeoutMs ?? 5000, () => this.fail({ kind: 'connect', message: 'no answer' }));
  }

  /** Finish quietly: parec ends, the connection closes, no callback. Safe at any time, any number of times. */
  stop(): void {
    if (this.phase === 'down') return;
    this.phase = 'down';
    this.teardown();
  }

  private openSocket(): void {
    if (this.phase !== 'connecting' || this.socket) return;
    const { opts } = this;
    let socket: Socket;
    try {
      socket = opts.connect(opts.port, opts.host);
    } catch (err) {
      this.fail({ kind: 'connect', message: socketReason(err) });
      return;
    }
    this.socket = socket;
    socket.on('error', (err) => this.fail(this.phase === 'streaming' ? { kind: 'closed', message: socketReason(err) } : { kind: 'connect', message: socketReason(err) }));
    socket.on('close', () => this.fail({ kind: 'closed', message: 'The connection was closed.' }));
    socket.on('data', (d: Buffer) => this.onReply(d));
    socket.on('drain', () => {
      this.waitingDrain = false;
      this.clearStall();
      this.flush();
    });
    socket.once('connect', () => {
      if (this.phase !== 'connecting') return;
      socket.setNoDelay?.(true);
      socket.write(`AUDIO ${FM_PROTOCOL} ${opts.token.reveal()}\n`);
      this.arm(opts.handshakeMs ?? 3000, () => this.fail({ kind: 'timeout' }));
    });
  }

  /** The helper's one line of answer. Anything after it is ignored: the helper has nothing more to say on this connection. */
  private onReply(data: Buffer): void {
    if (this.phase !== 'connecting') return;
    this.reply += data.toString('latin1');
    const nl = this.reply.indexOf('\n');
    if (nl < 0) {
      if (this.reply.length > 256) this.fail({ kind: 'refused', message: 'The other end did not answer like the FM helper.' });
      return;
    }
    const line = clean(this.reply.slice(0, nl), 160);
    if (line === 'OK') {
      this.clearTimer();
      this.phase = 'streaming';
      this.opts.onStreaming();
    } else if (line.startsWith('ERR')) {
      this.fail({ kind: 'refused', message: clean(line.slice(3), 120) || 'no reason given' });
    } else {
      this.fail({ kind: 'refused', message: 'The other end did not answer like the FM helper.' });
    }
  }

  private onSound(chunk: Buffer): void {
    // Sound that arrives before the helper has said OK is already out of date: not kept.
    if (this.phase !== 'streaming') return;
    let data = this.carry ? Buffer.concat([this.carry, chunk]) : chunk;
    this.carry = null;
    if (data.length % 2 === 1) {
      this.carry = Buffer.from(data.subarray(data.length - 1));
      data = data.subarray(0, data.length - 1);
    }
    if (data.length === 0) return;
    this.queue.push(data);
    this.queued += data.length;
    this.trim();
    this.flush();
  }

  /** Keep at most `maxBehindBytes` waiting: the oldest goes first. */
  private trim(): void {
    const max = (this.opts.maxBehindBytes ?? DEFAULT_MAX_BEHIND_BYTES) & ~1;
    while (this.queued > max && this.queue.length > 1) {
      const old = this.queue.shift()!;
      this.queued -= old.length;
      this.droppedBytes += old.length;
    }
    const only = this.queue[0];
    if (this.queue.length === 1 && only && this.queued > max) {
      // One piece larger than the allowance: keep its newest part, still a whole number of samples.
      this.queue[0] = only.subarray(only.length - max);
      this.droppedBytes += only.length - max;
      this.queued = max;
    }
  }

  private flush(): void {
    const socket = this.socket;
    if (this.phase !== 'streaming' || this.waitingDrain || !socket) return;
    while (this.queue.length > 0) {
      const piece = this.queue.shift()!;
      this.queued -= piece.length;
      this.sentBytes += piece.length;
      if (!socket.write(piece)) {
        // The connection is full. Later sound waits in the queue (bounded by `trim`) until it drains; if it never does, give up on it.
        this.waitingDrain = true;
        this.armStall();
        return;
      }
    }
  }

  private fail(failure: PumpFailure): void {
    if (this.phase === 'down') return;
    this.phase = 'down';
    this.teardown();
    this.opts.onDown(failure);
  }

  private teardown(): void {
    this.clearTimer();
    this.clearStall();
    this.queue = [];
    this.queued = 0;
    this.carry = null;
    this.socket?.destroy();
    const child = this.child;
    if (child && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      // parec ends on SIGTERM. If something keeps it alive, it is not left running.
      const kill = setTimeout(() => {
        this.killTimer = null;
        child.kill('SIGKILL');
      }, this.opts.killAfterMs ?? 2000);
      kill.unref();
      this.killTimer = kill;
      child.once('exit', () => {
        if (this.killTimer) clearTimeout(this.killTimer);
        this.killTimer = null;
      });
    }
  }

  private arm(ms: number, onTimeout: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      onTimeout();
    }, ms);
    this.timer.unref();
  }

  private armStall(): void {
    if (this.stallTimer) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      this.fail({ kind: 'closed', message: 'The FM helper stopped taking the sound.' });
    }, this.opts.stallMs ?? 5000);
    this.stallTimer.unref();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearStall(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }
}
