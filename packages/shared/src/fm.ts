/**
 * FM transmitter: the shapes the head unit, its screens and the FM helper agree on.
 *
 * The head unit's own Pi 5 cannot run the transmitter program (upstream supports the Pi 0 to 4 only), so the work is done by a small
 * helper, `fm_node.py`, on a Pi that can: this one when it is a Pi 4 or older, or a second Pi reached over the network. The server
 * talks to the helper; the screens talk to the server and see only `FmState`. See docs/fm.md.
 */

/** Version of the wire protocol between the server and the helper. The server shows "update the FM helper" when it differs. */
export const FM_PROTOCOL = 1;
export const FM_DEFAULT_CONTROL_PORT = 8788;
export const FM_DEFAULT_AUDIO_PORT = 8789;

/** The sound sent to the helper: raw signed 16-bit little-endian PCM, mono, at this rate (what fm_transmitter documents and handles). */
export const FM_SAMPLE_RATE = 22050;
export const FM_CHANNELS = 1;

/** The FM broadcast band, in MHz. The helper has its own (narrower or wider) limits and the server asks it what they are. */
export const FM_BAND = { min: 87.5, max: 108.0 } as const;
export const FM_FREQ_STEP = 0.1;
export const FM_DEFAULT_FREQUENCY = 88.1;
/** Peak frequency swing, as fm_transmitter's `-b` bandwidth in kHz (it swings half of this either side). 100 is its documented value. */
export const FM_BANDWIDTH_KHZ = 100;
/** Never more than this: 150 kHz is the plus-or-minus 75 kHz that broadcast FM allows. */
export const FM_BANDWIDTH_MAX_KHZ = 150;
export const FM_MAX_PRESETS = 6;

/** Bumped whenever the notice below changes in substance: everyone is asked again. */
export const FM_NOTICE_VERSION = 1;
/** What a person accepts before anything transmits. Shown by the screen, recorded by the server; the same words are in docs/fm.md. */
export const FM_NOTICE_POINTS: readonly string[] = [
  'Sending on FM frequencies needs permission in many countries, and is allowed only at very low power in others. You are responsible for following the rules where you drive.',
  'This sends a weak signal from a short piece of wire. It is not filtered and is meant to reach only your own car. Do not add an amplifier or a longer antenna.',
  'Choose a frequency with no station on it: tune the car radio across the band first. Never use a frequency that someone could be relying on.',
  'The sound is mono, about 11 kHz wide, and arrives one to two seconds late. A cable or Bluetooth to the car sounds better when you have one.',
];

export type FmMode = 'none' | 'local' | 'remote';
export type FmStatus = 'unconfigured' | 'unreachable' | 'unsupported' | 'idle' | 'starting' | 'transmitting' | 'error';

/** What the screens see (`svc.fm`). Everything here is safe to show: no address, no token. */
export interface FmState {
  /** Where the transmitter program runs: nowhere set up, on this Pi, or on a second Pi on the network. */
  mode: FmMode;
  status: FmStatus;
  /** The person switched it on. The server keeps trying until it is on the air, and again after a restart. */
  on: boolean;
  /** The notice has been accepted on this head unit, for this version of the notice. Nothing transmits before that. */
  acknowledged: boolean;
  frequency: number;
  presets: number[];
  /** Loudness of what is being sent, 0 to 1 (0 when nothing is on the air). */
  level: number;
  /** The helper's board ("Raspberry Pi 4 Model B Rev 1.4"), or null when not known. */
  board: string | null;
  /** The band the helper will accept. */
  limits: { min: number; max: number };
  /** One plain sentence about the state, or about what to do next. */
  detail: string;
  /** A simulation (the server was started with --demo): nothing is on the air. */
  demo: boolean;
}

export const NO_FM: FmState = {
  mode: 'none',
  status: 'unconfigured',
  on: false,
  acknowledged: false,
  frequency: FM_DEFAULT_FREQUENCY,
  presets: [],
  level: 0,
  board: null,
  limits: { min: FM_BAND.min, max: FM_BAND.max },
  detail: 'The FM transmitter is not set up. See docs/fm.md.',
  demo: false,
};

/** A frequency from outside, rounded to a tenth of a MHz, or null when it is not a number or is outside `limits`. */
export function normalizeFmFrequency(value: unknown, limits: { min: number; max: number } = FM_BAND): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  return rounded >= limits.min && rounded <= limits.max ? rounded : null;
}

/** `steps` tenths up (or down, when negative) from `from`, kept inside `limits`: the buttons never leave the band. */
export function stepFmFrequency(from: number, steps: number, limits: { min: number; max: number } = FM_BAND): number {
  const start = Number.isFinite(from) ? from : FM_DEFAULT_FREQUENCY;
  const next = Math.round(start * 10 + steps * (FM_FREQ_STEP * 10)) / 10;
  return Math.min(limits.max, Math.max(limits.min, next));
}

/** "100.6" (always one decimal, so the display does not jump in width). */
export const formatFmFrequency = (f: number): string => (Number.isFinite(f) ? f.toFixed(1) : '--.-');

/** A list of saved frequencies from outside: valid, unique, at most FM_MAX_PRESETS, in the order given. */
export function sanitizeFmPresets(value: unknown, limits: { min: number; max: number } = FM_BAND): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value.slice(0, 64)) {
    const f = normalizeFmFrequency(v, limits);
    if (f !== null && !out.includes(f)) out.push(f);
    if (out.length >= FM_MAX_PRESETS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The helper's side of the protocol (fm_node.py). JSON over HTTP on the control port; raw PCM on the audio port.
// ---------------------------------------------------------------------------

export type FmNodeState = 'idle' | 'transmitting' | 'error';

/** `GET /v1/status`. */
export interface FmNodeStatus {
  protocol: number;
  version: string;
  /** The board's model string, or null when it cannot be read. */
  board: string | null;
  /** False on any board the transmitter program is not known to work on (the Pi 5, anything unrecognised): it will not start there. */
  supported: boolean;
  /** Why not, in a plain sentence, when `supported` is false. */
  reason: string | null;
  state: FmNodeState;
  frequency: number | null;
  bandwidth: number | null;
  audio: { connected: boolean; level: number; underruns: number };
  error: string | null;
  limits: { min: number; max: number; maxBandwidth: number };
  /** The helper stops transmitting when it has heard nothing from the head unit for this many seconds. */
  deadmanS: number;
}

/** `POST /v1/start`: transmit on this frequency (or retune if already on the air). */
export interface FmNodeStartRequest {
  frequency: number;
  bandwidth: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null);
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

/**
 * The helper's answer, checked and cleaned (control characters removed, numbers clamped, text cut). Null when it is not an answer from
 * a helper at all. Never throws, whatever it is given: the helper may be a different version, or not a helper.
 */
export function parseFmNodeStatus(raw: unknown): FmNodeStatus | null {
  try {
    return readFmNodeStatus(raw);
  } catch {
    return null; // a value with a getter that throws: not something JSON can produce, and not an answer
  }
}

function readFmNodeStatus(raw: unknown): FmNodeStatus | null {
  if (!isObj(raw)) return null;
  const protocol = num(raw.protocol, 0, 1000);
  if (protocol === null || typeof raw.supported !== 'boolean') return null;
  const state: FmNodeState = raw.state === 'transmitting' || raw.state === 'error' ? raw.state : 'idle';
  const audio = isObj(raw.audio) ? raw.audio : {};
  const limits = isObj(raw.limits) ? raw.limits : {};
  const min = num(limits.min, 60, 120) ?? FM_BAND.min;
  const max = num(limits.max, 60, 120) ?? FM_BAND.max;
  return {
    protocol: Math.round(protocol),
    version: str(raw.version, 40) ?? '',
    board: str(raw.board, 120),
    supported: raw.supported,
    reason: str(raw.reason, 300),
    state,
    frequency: num(raw.frequency, 60, 120),
    bandwidth: num(raw.bandwidth, 0, 1000),
    audio: { connected: audio.connected === true, level: num(audio.level, 0, 1) ?? 0, underruns: Math.round(num(audio.underruns, 0, 1e9) ?? 0) },
    error: str(raw.error, 300),
    limits: { min: Math.min(min, max), max: Math.max(min, max), maxBandwidth: num(limits.maxBandwidth, 1, FM_BANDWIDTH_MAX_KHZ) ?? FM_BANDWIDTH_MAX_KHZ },
    deadmanS: Math.round(num(raw.deadmanS, 1, 3600) ?? 30),
  };
}
