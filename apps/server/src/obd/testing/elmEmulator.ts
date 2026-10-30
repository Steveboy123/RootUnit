import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { PIDS, hex2 } from '../pids';

/** What the pretend car reports (metric units). */
export interface EmuValues {
  rpm: number;
  speedKmh: number;
  coolantC: number;
  intakeC: number;
  throttlePct: number;
  loadPct: number;
  fuelPct: number;
  batteryV: number;
  ambientC: number;
}

export interface EmulatorOptions {
  values: () => EmuValues;
  /** Fixed TCP port (default: any free port). */
  port?: number;
  host?: string;
  /** 'can' = ISO 15765-4 (count byte in fault-code replies); 'iso' = older ISO 9141 style. */
  protocol?: 'can' | 'iso';
  /** PIDs the pretend car supports. Defaults to everything the app reads. */
  supported?: number[];
  stored?: string[];
  pending?: string[];
  mil?: () => boolean;
  /** Return false to simulate ignition off: the adapter answers but the car doesn't. */
  ecuOn?: () => boolean;
  /** Some ECUs refuse Mode 04 (clear) while the engine runs. */
  refuseClearWhenRunning?: boolean;
  /** Real adapters take a moment to answer. */
  latencyMs?: number;
  /** Clones that don't know ATAT1 answer "?". */
  noAdaptiveTiming?: boolean;
  /** Never answer (to test timeouts). */
  mute?: boolean;
}

const DEFAULT_SUPPORTED = [0x01, ...PIDS.map((p) => p.pid)].sort((a, b) => a - b);

export const encodeDtc = (code: string): [number, number] => {
  const letter = 'PCBU'.indexOf(code[0]!);
  const a = (letter << 6) | (Number(code[1]) << 4) | parseInt(code[2]!, 16);
  return [a, parseInt(code.slice(3, 5), 16)];
};

const bitmap = (base: number, supported: number[]): string => {
  const bytes = [0, 0, 0, 0];
  for (const p of supported) {
    const i = p - base - 1;
    if (i >= 0 && i < 32) bytes[i >> 3]! |= 0x80 >> (i & 7);
  }
  // Bit 32 of a page says "the next page exists".
  if (supported.some((p) => p > base + 32)) bytes[3]! |= 1;
  return bytes.map(hex2).join('');
};

function pidData(pid: number, v: EmuValues, mil: boolean, count: number): string | null {
  switch (pid) {
    case 0x01:
      return `${hex2((mil ? 0x80 : 0) | count)}07E500`;
    case 0x0c: {
      const n = Math.round(v.rpm * 4);
      return hex2(n >> 8) + hex2(n & 0xff);
    }
    case 0x0d:
      return hex2(Math.round(v.speedKmh));
    case 0x05:
      return hex2(Math.round(v.coolantC + 40));
    case 0x0f:
      return hex2(Math.round(v.intakeC + 40));
    case 0x46:
      return hex2(Math.round(v.ambientC + 40));
    case 0x11:
      return hex2(Math.round((v.throttlePct * 255) / 100));
    case 0x04:
      return hex2(Math.round((v.loadPct * 255) / 100));
    case 0x2f:
      return hex2(Math.round((v.fuelPct * 255) / 100));
    case 0x42: {
      const mv = Math.round(v.batteryV * 1000);
      return hex2(mv >> 8) + hex2(mv & 0xff);
    }
    default:
      return null;
  }
}

/** A tiny ELM327 + ECU: enough protocol fidelity to exercise the real client and provider. */
export async function startElmEmulator(opts: EmulatorOptions) {
  const supported = opts.supported ?? DEFAULT_SUPPORTED;
  const stored = opts.stored ?? [];
  const pending = opts.pending ?? [];
  const can = (opts.protocol ?? 'can') === 'can';
  const sockets = new Set<Socket>();
  const log: string[] = [];
  let connected = false; // has the protocol search been done yet?

  const dtcReply = (mode: '43' | '47', codes: string[]): string[] => {
    const pairs = codes.flatMap((c) => encodeDtc(c).map(hex2));
    if (can) {
      const body = mode + hex2(codes.length) + pairs.join('');
      if (pairs.length <= 6) return [body]; // fits one CAN frame (+ padding the adapter strips)
      // multi-frame: length line, then "0:", "1:" … lines of 7 bytes
      const bytes = body.match(/../g)!;
      const lines = [`${bytes.length.toString(16).toUpperCase().padStart(3, '0')}`];
      for (let i = 0, n = 0; i < bytes.length; i += 7, n++) lines.push(`${n.toString(16).toUpperCase()}: ${bytes.slice(i, i + 7).join(' ')}`);
      return lines;
    }
    const lines: string[] = [];
    for (let i = 0; i < Math.max(codes.length, 1); i += 3) {
      const chunk = pairs.slice(i * 2, i * 2 + 6);
      while (chunk.length < 6) chunk.push('00');
      lines.push(`${mode} ${chunk.join(' ')}`);
    }
    return lines;
  };

  function respond(cmdRaw: string): string[] {
    const cmd = cmdRaw.replace(/\s+/g, '').toUpperCase();
    const v = opts.values();
    const ecu = opts.ecuOn?.() ?? true;

    if (cmd.startsWith('AT')) {
      switch (cmd) {
        case 'ATE0':
        case 'ATE1':
        case 'ATL0':
        case 'ATL1':
        case 'ATS0':
        case 'ATS1':
        case 'ATH0':
        case 'ATH1':
        case 'ATSP0':
          return ['OK'];
        case 'ATAT1':
          return opts.noAdaptiveTiming ? ['?'] : ['OK'];
        case 'ATI':
          return ['ELM327 v1.5'];
        case 'ATRV':
          return [`${v.batteryV.toFixed(1)}V`];
        case 'ATDP':
          return [connected ? `AUTO, ${can ? 'ISO 15765-4 (CAN 11/500)' : 'ISO 9141-2'}` : 'AUTO'];
        case 'ATDPN':
          return [connected ? (can ? 'A6' : 'A3') : 'A0'];
        default:
          return ['?'];
      }
    }

    const mode = cmd.slice(0, 2);
    if (mode === '01') {
      const pid = parseInt(cmd.slice(2, 4), 16);
      if (!connected) {
        if (!ecu) return ['SEARCHING...', 'UNABLE TO CONNECT'];
        connected = true;
        return ['SEARCHING...', `4100${bitmap(0, supported)}`];
      }
      if (!ecu) return ['NO DATA'];
      if (pid === 0x00) return [`4100${bitmap(0, supported)}`];
      if (pid === 0x20) return [`4120${bitmap(0x20, supported)}`];
      if (pid === 0x40) return [`4140${bitmap(0x40, supported)}`];
      if (!supported.includes(pid)) return ['NO DATA'];
      const d = pidData(pid, v, opts.mil?.() ?? stored.length > 0, stored.length);
      return d === null ? ['NO DATA'] : [`41${hex2(pid)}${d}`];
    }
    if (mode === '03') return ecu ? dtcReply('43', stored) : ['NO DATA'];
    if (mode === '07') return ecu ? (pending.length ? dtcReply('47', pending) : can ? ['4700'] : ['NO DATA']) : ['NO DATA'];
    if (mode === '04') {
      if (!ecu) return ['NO DATA'];
      if (opts.refuseClearWhenRunning && v.rpm > 0) return ['7F0422'];
      stored.length = 0;
      pending.length = 0;
      return ['44'];
    }
    return ['?'];
  }

  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    let echo = true;
    let inbuf = '';
    sock.on('data', (b) => {
      inbuf += b.toString('latin1');
      let i: number;
      while ((i = inbuf.indexOf('\r')) >= 0) {
        const cmd = inbuf.slice(0, i).replace(/\n/g, '');
        inbuf = inbuf.slice(i + 1);
        if (!cmd) continue;
        log.push(cmd);
        if (opts.mute) continue;
        const norm = cmd.replace(/\s+/g, '').toUpperCase();
        if (norm === 'ATZ') {
          echo = true;
          connected = false;
          setTimeout(() => sock.write('\r\rELM327 v1.5\r\r>'), opts.latencyMs ?? 5);
          continue;
        }
        const lines = respond(cmd);
        if (norm === 'ATE0') echo = false;
        if (norm === 'ATE1') echo = true;
        const out = `${echo || norm === 'ATE0' ? `${cmd}\r` : ''}${lines.join('\r')}\r\r>`;
        setTimeout(() => !sock.destroyed && sock.write(out), opts.latencyMs ?? 5);
      }
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', r));

  return {
    port: (server.address() as AddressInfo).port,
    /** Every command received, in order. */
    log,
    /** Simulate the Bluetooth link dropping. */
    dropClients() {
      for (const s of sockets) s.destroy();
    },
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
