import { FM_DEFAULT_FREQUENCY, normalizeFmFrequency, sanitizeFmPresets } from '@headunit/shared';

/** `data/fm.json`. Hardware specific, so it is not part of a backup. Never holds the helper's password (that is in .env only). */
export const FM_FILE = 'fm.json';

export interface FmFile {
  version: 1;
  frequency: number;
  /** What the person asked for last. Kept so the transmitter comes back by itself after a restart (once the notice is accepted). */
  on: boolean;
  presets: number[];
  /** The notice accepted on this head unit: which version, and when. */
  ack: { version: number; at: number } | null;
}

export const DEFAULT_FM_FILE: FmFile = { version: 1, frequency: FM_DEFAULT_FREQUENCY, on: false, presets: [], ack: null };

/** What was saved, checked field by field. Anything unusable becomes the default for that field; never throws. */
export function sanitizeFmFile(raw: unknown): FmFile {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_FM_FILE, presets: [] };
    const r = raw as Record<string, unknown>;
    const ack = r.ack;
    let sanitizedAck: FmFile['ack'] = null;
    if (typeof ack === 'object' && ack !== null && !Array.isArray(ack)) {
      const a = ack as Record<string, unknown>;
      if (typeof a.version === 'number' && Number.isInteger(a.version) && a.version >= 1 && typeof a.at === 'number' && Number.isFinite(a.at) && a.at >= 0) {
        sanitizedAck = { version: a.version, at: a.at };
      }
    }
    return {
      version: 1,
      frequency: normalizeFmFrequency(r.frequency) ?? FM_DEFAULT_FREQUENCY,
      on: r.on === true,
      presets: sanitizeFmPresets(r.presets),
      ack: sanitizedAck,
    };
  } catch {
    return { ...DEFAULT_FM_FILE, presets: [] };
  }
}
