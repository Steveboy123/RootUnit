import type { VehicleKey } from '@headunit/shared';

/** Mode 01 PIDs we read. Formulas are from SAE J1979 (the public OBD-II standard). */
export interface PidDef {
  pid: number;
  key: VehicleKey;
  /** Data bytes in the response (after "41 xx"). */
  bytes: number;
  decode(b: number[]): number;
}

const byte = (b: number[], i: number) => b[i] ?? 0;

export const PIDS: PidDef[] = [
  { pid: 0x0c, key: 'rpm', bytes: 2, decode: (b) => (byte(b, 0) * 256 + byte(b, 1)) / 4 },
  { pid: 0x0d, key: 'speedKmh', bytes: 1, decode: (b) => byte(b, 0) },
  { pid: 0x05, key: 'coolantC', bytes: 1, decode: (b) => byte(b, 0) - 40 },
  { pid: 0x0f, key: 'intakeC', bytes: 1, decode: (b) => byte(b, 0) - 40 },
  { pid: 0x11, key: 'throttlePct', bytes: 1, decode: (b) => (byte(b, 0) * 100) / 255 },
  { pid: 0x04, key: 'loadPct', bytes: 1, decode: (b) => (byte(b, 0) * 100) / 255 },
  { pid: 0x2f, key: 'fuelPct', bytes: 1, decode: (b) => (byte(b, 0) * 100) / 255 },
  { pid: 0x42, key: 'batteryV', bytes: 2, decode: (b) => (byte(b, 0) * 256 + byte(b, 1)) / 1000 },
  { pid: 0x46, key: 'ambientC', bytes: 1, decode: (b) => byte(b, 0) - 40 },
];

export const pidDef = (pid: number) => PIDS.find((p) => p.pid === pid);
export const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * Normalise an ELM327 reply: spaces/case removed, multi-line "0:"/"1:" frame prefixes stripped,
 * and the 3-digit total-length line that precedes a multi-frame reply dropped.
 */
export function normalizeLines(lines: string[]): string[] {
  const out: string[] = [];
  const hasFramePrefix = lines.some((l) => /^[0-9A-F]:/i.test(l.trim()));
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, '').toUpperCase();
    if (!l) continue;
    if (hasFramePrefix && /^[0-9A-F]{3}$/.test(l)) continue; // "00B": byte count of the multi-frame reply
    out.push(l.replace(/^[0-9A-F]:/, ''));
  }
  return out;
}

const toBytes = (hex: string): number[] => {
  const b: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  return b;
};

/** Data bytes for a Mode 01 reply to `pid`, or null if no line answers it. */
export function parseMode01(lines: string[], pid: number): number[] | null {
  const prefix = `41${hex2(pid)}`;
  const line = normalizeLines(lines).find((l) => l.startsWith(prefix));
  return line ? toBytes(line.slice(prefix.length)) : null;
}

/** Decode a "supported PIDs" bitmap: PID base+1 is the top bit of the first byte. */
export function supportedFromMask(base: number, bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const b = bytes[i >> 3];
    if (b !== undefined && b & (0x80 >> (i & 7))) out.push(base + i + 1);
  }
  return out;
}

/** PID 01: bit 7 of the first byte is the check-engine lamp, the low 7 bits the stored-code count. */
export function decodeMil(bytes: number[]): { on: boolean; count: number } {
  const a = bytes[0] ?? 0;
  return { on: (a & 0x80) !== 0, count: a & 0x7f };
}

// ---------------------------------------------------------------------------
// Fault codes
// ---------------------------------------------------------------------------

/** Two bytes → "P0420". All-zero is padding, not a code. */
export function dtcFromBytes(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  const letter = 'PCBU'[a >> 6]!;
  return `${letter}${(a >> 4) & 3}${(a & 0xf).toString(16).toUpperCase()}${hex2(b)}`;
}

/**
 * Decode a Mode 03 (stored) or 07 (pending) reply. CAN replies carry a count byte after the mode
 * byte; the older J1850/ISO protocols don't and send 3 codes per line, zero padded — so the caller
 * must say which it is (from the adapter's reported protocol).
 */
export function decodeDtcs(lines: string[], mode: '43' | '47', can: boolean): string[] {
  const norm = normalizeLines(lines);
  const codes: string[] = [];
  const addPairs = (bytes: number[], limit = Infinity) => {
    for (let i = 0; i + 1 < bytes.length && (i >> 1) < limit; i += 2) {
      const c = dtcFromBytes(bytes[i]!, bytes[i + 1]!);
      if (c) codes.push(c);
    }
  };
  if (can) {
    // One ECU's reply may span several frames: a line starting with the mode byte begins a reply and
    // the lines after it (until the next such line) are its continuation frames.
    const replies: string[] = [];
    for (const l of norm) {
      if (l.startsWith(mode)) replies.push(l);
      else if (replies.length) replies[replies.length - 1] += l;
    }
    for (const reply of replies) {
      const bytes = toBytes(reply.slice(2));
      addPairs(bytes.slice(1), bytes[0]); // bytes[0] is the number of codes
    }
  } else {
    for (const l of norm) if (l.startsWith(mode)) addPairs(toBytes(l.slice(2)));
  }
  return [...new Set(codes)];
}

/** Generic powertrain codes everyone sees; manufacturer-specific codes have no entry here. */
export const DTC_DESCRIPTIONS: Record<string, string> = {
  P0016: 'Crankshaft / camshaft position correlation (bank 1 sensor A)',
  P0101: 'Mass air flow sensor range / performance',
  P0113: 'Intake air temperature sensor circuit high',
  P0128: 'Coolant thermostat (coolant below regulating temperature)',
  P0133: 'O2 sensor circuit slow response (bank 1 sensor 1)',
  P0171: 'Fuel system too lean (bank 1)',
  P0172: 'Fuel system too rich (bank 1)',
  P0174: 'Fuel system too lean (bank 2)',
  P0300: 'Random / multiple cylinder misfire detected',
  P0301: 'Cylinder 1 misfire detected',
  P0302: 'Cylinder 2 misfire detected',
  P0303: 'Cylinder 3 misfire detected',
  P0304: 'Cylinder 4 misfire detected',
  P0335: 'Crankshaft position sensor circuit',
  P0420: 'Catalyst system efficiency below threshold (bank 1)',
  P0430: 'Catalyst system efficiency below threshold (bank 2)',
  P0442: 'EVAP system small leak detected',
  P0446: 'EVAP vent control circuit',
  P0455: 'EVAP system large leak detected',
  P0456: 'EVAP system very small leak detected',
  P0500: 'Vehicle speed sensor malfunction',
  P0505: 'Idle control system malfunction',
  P0507: 'Idle control system RPM higher than expected',
  P0700: 'Transmission control system malfunction',
};
