import { hex2, parseMode01 } from './pids';
import type { Transport } from './transport';

export type ElmErrorKind = 'timeout' | 'no-data' | 'unable' | 'bus' | 'negative' | 'unknown' | 'closed';

export class ElmError extends Error {
  constructor(
    public kind: ElmErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const NEGATIVE_REASONS: Record<string, string> = {
  '11': 'service not supported',
  '12': 'sub-function not supported',
  '22': 'conditions not correct — try again with the key on and the engine off',
  '78': 'ECU is busy',
};

/** Lines the adapter prints that are status chatter, not data. */
const NOISE = /^(SEARCHING\.\.\.|BUS INIT: ?OK|BUS INIT: ?\.\.\.OK|\.+)$/i;

/** ELM327 error strings → how to treat them. */
function classify(line: string): ElmError | null {
  // Words stay separated ("NO DATA"); only the negative-response form ("7F 04 22") is compared compacted.
  const l = line.replace(/\s+/g, ' ').trim().toUpperCase();
  if (l === 'NO DATA') return new ElmError('no-data', 'No data');
  if (l === 'UNABLE TO CONNECT') return new ElmError('unable', 'The adapter cannot reach the car (ignition off?)');
  if (l === '?') return new ElmError('unknown', 'The adapter did not understand the command');
  if (/^(CAN ERROR|BUS BUSY|BUS ERROR|BUS INIT: ?ERROR|FB ERROR|DATA ERROR|<?(DATA|RX) ERROR|BUFFER FULL|STOPPED|ACT ALERT|LV RESET|LP ALERT)$/.test(l)) {
    return new ElmError('bus', `Adapter reported: ${line}`);
  }
  const neg = /^7F([0-9A-F]{2})([0-9A-F]{2})$/.exec(l.replace(/ /g, ''));
  if (neg) return new ElmError('negative', `The car refused (${NEGATIVE_REASONS[neg[2]!] ?? `code ${neg[2]}`})`);
  return null;
}

export interface ElmInfo {
  adapter: string;
}

/**
 * Talks to an ELM327 (or compatible) adapter. One command is in flight at a time; replies end at the
 * '>' prompt. After any timeout the link should be treated as desynchronised and reopened.
 */
export class Elm327 {
  private buf = '';
  private waiter: (() => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private t: Transport,
    private defaultTimeoutMs = 3000,
  ) {
    t.onData((c) => {
      this.buf += c;
      if (this.buf.includes('>')) this.waiter?.();
    });
    t.onClose(() => {
      this.closed = true;
      this.waiter?.();
    });
  }

  /** Send a command and return its cleaned reply lines; throws ElmError for adapter/car errors. */
  cmd(command: string, timeoutMs = this.defaultTimeoutMs): Promise<string[]> {
    const run = () => this.exec(command, timeoutMs);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {}); // a failed command must not poison the queue
    return p;
  }

  private exec(command: string, timeoutMs: number): Promise<string[]> {
    if (this.closed) return Promise.reject(new ElmError('closed', 'The adapter link is closed'));
    this.buf = '';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ElmError('timeout', `No reply to ${command}`));
      }, timeoutMs);
      this.waiter = () => {
        clearTimeout(timer);
        this.waiter = null;
        if (!this.buf.includes('>')) return reject(new ElmError('closed', 'The adapter link dropped'));
        const lines = this.buf
          .slice(0, this.buf.indexOf('>'))
          .split(/[\r\n]+/)
          .map((l) => l.trim())
          .filter((l) => l && l.toUpperCase() !== command.toUpperCase() && !NOISE.test(l)); // drop echo + chatter
        for (const l of lines) {
          const err = classify(l);
          if (err) return reject(err);
        }
        resolve(lines);
      };
      this.t.write(`${command}\r`);
    });
  }

  /** Reset and configure the adapter: no echo/linefeeds/spaces/headers, automatic protocol. */
  async init(): Promise<ElmInfo> {
    const reset = await this.cmd('ATZ', 6000);
    const adapter = reset.find((l) => /ELM|STN|OBD/i.test(l)) ?? 'ELM327-compatible adapter';
    await this.cmd('ATE0');
    for (const c of ['ATL0', 'ATS0', 'ATH0', 'ATSP0']) await this.cmd(c);
    // Adaptive timing is optional; some clones answer "?" — that's fine.
    await this.cmd('ATAT1').catch((e: ElmError) => {
      if (e.kind !== 'unknown') throw e;
    });
    return { adapter };
  }

  /** Probe for the car (the first request triggers the adapter's protocol search, which can take seconds). */
  async connectEcu(): Promise<{ protocol: string; can: boolean }> {
    await this.cmd('0100', 20_000);
    const protocol = (await this.cmd('ATDP').catch(() => ['unknown protocol']))[0] ?? 'unknown protocol';
    const num = (await this.cmd('ATDPN').catch(() => ['']))[0] ?? '';
    return { protocol: protocol.replace(/^AUTO,\s*/i, ''), can: /[6-9]$/.test(num.replace(/^A/i, '')) };
  }

  /** Read a Mode 01 PID; null when the car answered without that PID. */
  async pid(pid: number): Promise<number[] | null> {
    const lines = await this.cmd(`01${hex2(pid)}`);
    return parseMode01(lines, pid);
  }

  /** Battery voltage as seen by the adapter itself (OBD pin 16), e.g. "12.6V". */
  async adapterVoltage(): Promise<number | null> {
    const m = /(\d{1,2}(?:\.\d)?)\s*V/i.exec((await this.cmd('ATRV'))[0] ?? '');
    return m ? Number(m[1]) : null;
  }

  async close() {
    this.closed = true;
    this.waiter?.();
    await this.t.close();
  }
}
