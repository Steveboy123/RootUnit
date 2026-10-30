import { FM_BAND, FM_DEFAULT_FREQUENCY, FM_MAX_PRESETS, FM_NOTICE_VERSION, formatFmFrequency, sanitizeFmPresets, stepFmFrequency, type FmMode, type FmState, type FmStatus } from '@headunit/shared';
import type { Tone } from '../components/ui';
import { apiRequest } from './api';

/**
 * The FM transmitter screen, minus the drawing: what the page says for every state the head unit can report, what a tap on the switch
 * does, which help to show, and the calls to the head unit. Everything here is a plain function so it can be tested without a screen.
 */

const STATUSES: readonly FmStatus[] = ['unconfigured', 'unreachable', 'unsupported', 'idle', 'starting', 'transmitting', 'error'];
const MODES: readonly FmMode[] = ['none', 'local', 'remote'];
const FM_FLOOR = 60;
const FM_CEILING = 120;
/** A longer sentence than this is cut: the head unit's own text is short, so this only ever applies to something odd. */
const DETAIL_MAX = 240;
const BOARD_MAX = 120;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One line of text from outside: control and line-separator characters become spaces, runs of spaces collapse, and it is cut with an ellipsis. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ---------------------------------------------------------------------------
// What the page works from
// ---------------------------------------------------------------------------

/** `svc.fm` made safe to draw: every field has a sensible value whatever arrived (or nothing at all, before the first snapshot). */
export interface FmView {
  /** False until the first snapshot has arrived: there is nothing to show or do yet. */
  ready: boolean;
  mode: FmMode;
  status: FmStatus;
  on: boolean;
  acknowledged: boolean;
  /** The tuned frequency in MHz, to a tenth, or null when what arrived was not a frequency. */
  frequency: number | null;
  /** Saved frequencies that fit inside `limits`, at most FM_MAX_PRESETS. */
  presets: number[];
  /** 0 to 1. */
  level: number;
  board: string | null;
  limits: { min: number; max: number };
  detail: string;
  demo: boolean;
}

const UNKNOWN_STATE_TEXT = 'The head unit sent a state this screen does not know. Reload the page.';

export function fmView(fm: FmState | null | undefined): FmView {
  const raw: Record<string, unknown> | null = isObj(fm) ? fm : null;
  if (!raw) {
    return { ready: false, mode: 'none', status: 'unconfigured', on: false, acknowledged: false, frequency: null, presets: [], level: 0, board: null, limits: { ...FM_BAND }, detail: '', demo: false };
  }
  const known = STATUSES.includes(raw.status as FmStatus);
  const l = isObj(raw.limits) ? raw.limits : {};
  const limits = isNum(l.min) && isNum(l.max) && l.min >= FM_FLOOR && l.max <= FM_CEILING && l.min < l.max ? { min: l.min, max: l.max } : { ...FM_BAND };
  const f = isNum(raw.frequency) ? Math.round(raw.frequency * 10) / 10 : null;
  return {
    ready: true,
    mode: MODES.includes(raw.mode as FmMode) ? (raw.mode as FmMode) : 'none',
    status: known ? (raw.status as FmStatus) : 'error',
    on: raw.on === true,
    acknowledged: raw.acknowledged === true,
    frequency: f !== null && f >= FM_FLOOR && f <= FM_CEILING ? f : null,
    presets: sanitizeFmPresets(raw.presets, limits),
    level: isNum(raw.level) ? Math.min(1, Math.max(0, raw.level)) : 0,
    board: cleanLine(raw.board, BOARD_MAX) || null,
    limits,
    detail: known ? cleanLine(raw.detail, DETAIL_MAX) : UNKNOWN_STATE_TEXT,
    demo: raw.demo === true,
  };
}

/** The frequency as the big readout shows it: one decimal, or dashes when there is none. */
export const frequencyText = (f: number | null): string => formatFmFrequency(f ?? Number.NaN);

// ---------------------------------------------------------------------------
// The status line
// ---------------------------------------------------------------------------

export type StatusKind = 'connecting' | 'on-air' | 'starting' | 'off' | 'setup' | 'unreachable' | 'unsupported' | 'problem';

export interface StatusLine {
  kind: StatusKind;
  /** A short word or two that says it without colour. */
  label: string;
  /** One plain sentence: the head unit's own, or ours when it sent none. */
  detail: string;
  tone: Tone | undefined;
}

/** The state in words. The tone and the icon are extra: the label always says it too. */
export function statusLine(v: FmView): StatusLine {
  if (!v.ready) return { kind: 'connecting', label: 'Connecting', detail: 'Waiting for the head unit.', tone: undefined };
  const say = (kind: StatusKind, label: string, tone: Tone | undefined, fallback: string): StatusLine => ({ kind, label, detail: v.detail || fallback, tone });
  switch (v.status) {
    case 'transmitting':
      return say('on-air', 'On the air', 'ok', v.frequency === null ? 'Sending sound to the car radio.' : `Sending sound to the car radio on ${frequencyText(v.frequency)} MHz.`);
    case 'starting':
      return say('starting', 'Starting', 'info', 'Getting the transmitter ready. This takes a few seconds.');
    case 'idle':
      return v.on ? say('starting', 'Switching on', 'info', 'The transmitter is about to start.') : say('off', 'Off', undefined, 'Ready. Switch it on to send sound to the car radio.');
    case 'unconfigured':
      return say('setup', 'Not set up', 'warn', 'The FM transmitter is not set up yet. The steps are below.');
    case 'unreachable':
      return say('unreachable', 'Can’t reach the helper', 'warn', 'The head unit cannot reach the FM helper. Check the steps below.');
    case 'unsupported':
      return say('unsupported', 'Not supported on this Pi', 'warn', 'The Pi that would transmit is not one the transmitter program works on.');
    case 'error':
      return say('problem', 'Problem', 'danger', 'The FM helper reported a problem.');
  }
}

/** The word under the level meter, and its spoken value. */
export function levelWord(level: number): string {
  if (!(level >= 0.02)) return 'No sound';
  if (level < 0.1) return 'Quiet';
  if (level < 0.9) return 'Playing';
  return 'Very loud';
}

/** Where the transmitter is: "On a second Pi: Raspberry Pi Zero 2 W Rev 1.0". Null when nothing is set up and nothing is known. */
export function transmitterLine(v: FmView): string | null {
  const where = v.mode === 'local' ? 'On this Pi' : v.mode === 'remote' ? 'On a second Pi' : null;
  if (where === null) return v.board;
  return v.board ? `${where}: ${v.board}` : where;
}

// ---------------------------------------------------------------------------
// The tuner
// ---------------------------------------------------------------------------

export interface StepButton {
  /** Tenths of a MHz: -10 is one MHz down. */
  steps: number;
  /** What is drawn on the button. */
  label: string;
  /** What a screen reader says. */
  aria: string;
  disabled: boolean;
}

const STEP_BUTTONS: ReadonlyArray<Pick<StepButton, 'steps' | 'label' | 'aria'>> = [
  { steps: -10, label: '−1', aria: 'Down 1 megahertz' },
  { steps: -1, label: '−0.1', aria: 'Down 0.1 megahertz' },
  { steps: 1, label: '+0.1', aria: 'Up 0.1 megahertz' },
  { steps: 10, label: '+1', aria: 'Up 1 megahertz' },
];

/** Where a press of a step button lands: always inside the band the transmitter accepts. */
export const nextFrequency = (from: number | null, steps: number, limits: { min: number; max: number }): number => stepFmFrequency(from ?? FM_DEFAULT_FREQUENCY, steps, limits);

export interface TunerView {
  text: string;
  range: string;
  buttons: StepButton[];
}

/** The readout and its four buttons. A button that could not move the frequency any further (the end of the band) is off. */
export function tunerView(v: FmView, shown: number | null): TunerView {
  return {
    text: frequencyText(shown),
    range: `This transmitter tunes ${v.limits.min.toFixed(1)} to ${v.limits.max.toFixed(1)} MHz.`,
    buttons: STEP_BUTTONS.map((b) => ({ ...b, disabled: !v.ready || (shown !== null && nextFrequency(shown, b.steps, v.limits) === shown) })),
  };
}

// ---------------------------------------------------------------------------
// Saved frequencies
// ---------------------------------------------------------------------------

export interface PresetsView {
  chips: Array<{ frequency: number; text: string; active: boolean }>;
  /** Is the frequency on the dial saved already? Then the button removes it. */
  saved: boolean;
  /** The save / remove button cannot be used. */
  disabled: boolean;
  hint: string | null;
}

export function presetsView(v: FmView, shown: number | null): PresetsView {
  const saved = shown !== null && v.presets.includes(shown);
  const full = v.presets.length >= FM_MAX_PRESETS;
  let hint: string | null = null;
  if (!saved && full) hint = `You can keep ${FM_MAX_PRESETS}. Tap one of them, then Remove, to make room.`;
  else if (v.presets.length === 0) hint = 'Nothing saved yet. Find a spot where the car radio hears only static, then tap Save this.';
  return {
    chips: v.presets.map((frequency) => ({ frequency, text: frequencyText(frequency), active: frequency === shown })),
    saved,
    disabled: !v.ready || shown === null || (!saved && full),
    hint,
  };
}

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

export const SWITCH_TITLE = 'Send sound to the car radio';

export interface SwitchView {
  checked: boolean;
  /** Cannot be switched ON (it can always be switched off). Shown as unavailable, with the reason in `hint`. */
  disabled: boolean;
  stateWord: 'On' | 'Off';
  hint: string;
}

export function switchView(v: FmView): SwitchView {
  const blocked = v.status === 'unconfigured' || v.status === 'unsupported';
  const disabled = !v.ready || (!v.on && blocked);
  let hint: string;
  if (!v.ready) hint = 'Waiting for the head unit.';
  else if (disabled) hint = v.status === 'unconfigured' ? 'Set up the FM helper first. The steps are below.' : 'The Pi that would transmit is not supported. See below.';
  else if (!v.on) hint = v.acknowledged ? 'Tap to start sending.' : 'The first time, you read a short notice before it starts.';
  else if (v.status === 'transmitting') hint = v.frequency === null ? 'Sending now. Tap to switch off.' : `Sending on ${frequencyText(v.frequency)} MHz. Tap to switch off.`;
  else if (v.status === 'starting' || v.status === 'idle') hint = 'Starting. It stays on until you switch it off.';
  else hint = 'Switched on, but not working yet. It keeps trying and starts by itself when it can. Tap to switch off.';
  return { checked: v.ready && v.on, disabled, stateWord: v.ready && v.on ? 'On' : 'Off', hint };
}

export type SwitchPress = 'none' | 'notice' | 'on' | 'off';

/**
 * What a tap on the switch does. Switching ON without the notice accepted opens the notice and never anything else: the person has
 * to read it and tap "I understand" themselves. (The head unit refuses it as well; this is so the screen never even asks.)
 */
export function switchPress(v: FmView): SwitchPress {
  if (!v.ready) return 'none';
  if (v.on) return 'off';
  if (switchView(v).disabled) return 'none';
  return v.acknowledged ? 'on' : 'notice';
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export interface HelpStep {
  text: string;
  /** Typed on the other Pi or into the .env file; shown in a box so it is clear where the words end. */
  command?: string;
}

export interface FmHelp {
  kind: 'unconfigured' | 'unreachable' | 'unsupported' | 'error';
  title: string;
  intro: string;
  steps: HelpStep[];
}

export const FM_DOCS = 'docs/fm.md';
const SETUP_NODE = 'sudo ./deploy/setup-fm.sh node';
const ENV_LINES = 'FM_NODE_URL=http://ADDRESS:8788\nFM_NODE_TOKEN=PASSWORD';

/** The next step in plain words, for the states that need the person to do something. Null when nothing is wrong. */
export function helpFor(v: FmView): FmHelp | null {
  if (!v.ready) return null;
  switch (v.status) {
    case 'unconfigured':
      return {
        kind: 'unconfigured',
        title: 'Set up the transmitter',
        intro: 'The transmitter program only runs on a Raspberry Pi Zero, 1, 2, 3 or 4. A Pi 5 cannot run it, so the usual way is a second, small Pi in the car (a Zero 2 W is enough).',
        steps: [
          { text: 'Copy this project to the second Pi and run this there:', command: SETUP_NODE },
          { text: 'It prints a password and that Pi’s address. Put them in the .env file on the head unit, in place of ADDRESS and PASSWORD:', command: ENV_LINES },
          { text: 'Restart the head unit program so it reads the new lines.' },
          { text: 'If this head unit is itself a Pi 4 or older, run this on it instead. It adds the lines to .env for you:', command: 'sudo ./deploy/setup-fm.sh local' },
        ],
      };
    case 'unreachable':
      return {
        kind: 'unreachable',
        title: 'The FM helper does not answer',
        intro: 'The head unit cannot talk to the helper program that does the transmitting. Check these, in order:',
        steps: [
          { text: 'Is the Pi with the transmitter switched on, and on the same network as the head unit?' },
          { text: 'Is the helper running? On that Pi:', command: 'sudo systemctl status headunit-fm-node' },
          { text: 'Is the address right? FM_NODE_URL in the head unit’s .env must be that Pi’s address, with port 8788.' },
          { text: 'Is the password the same? FM_NODE_TOKEN in the head unit’s .env must match TOKEN in /etc/headunit-fm-node.conf on that Pi.' },
        ],
      };
    case 'unsupported': {
      const where = v.mode === 'local' ? 'The Pi this head unit runs on' : 'The Pi that has the FM helper';
      return {
        kind: 'unsupported',
        title: 'This Pi cannot run the transmitter',
        intro: `${where} is not one the transmitter program works on (the Pi 5 and newer are not).${v.board ? ` It reports: ${v.board}.` : ''}`,
        steps: [
          { text: 'Use a Pi Zero, Zero 2 W, 3 or 4 for the transmitter. On it, run:', command: SETUP_NODE },
          { text: 'Put its address and password in the head unit’s .env as FM_NODE_URL and FM_NODE_TOKEN, then restart the head unit program.' },
        ],
      };
    }
    case 'error':
      return {
        kind: 'error',
        title: 'The FM helper reported a problem',
        intro: 'The message above says what it found. These are the usual causes:',
        steps: [
          { text: 'The password does not match. FM_NODE_TOKEN in the head unit’s .env must equal TOKEN in /etc/headunit-fm-node.conf on the transmitter Pi.' },
          { text: 'The helper is out of date. Copy the newest project to that Pi and run the setup again:', command: SETUP_NODE },
          { text: 'The transmitter program stopped. To see why, on that Pi:', command: 'sudo journalctl -u headunit-fm-node -n 30' },
          { text: 'Then switch the transmitter off and on again here.' },
        ],
      };
    default:
      return null;
  }
}

/** How it works, the antenna and the delay, for the "How it works and the rules" section. */
export const HOW_IT_WORKS: readonly string[] = [
  'The head unit records its own sound and sends it over the network to a small helper on a Raspberry Pi (a Zero, 1, 2, 3 or 4). The helper turns one pin of that Pi into a weak FM radio signal.',
  'The aerial is a piece of plain wire, 20 to 40 cm long, on GPIO4 (pin 7) of the Pi that transmits. If the helper was set up with the --gpio21 option, which upstream advises for the Pi 4, use GPIO21 (pin 40) instead. Add nothing else: no amplifier, no longer wire.',
  'The sound is mono and arrives one to two seconds late, so it will not line up with anything you see on the screen.',
];

// ---------------------------------------------------------------------------
// Talking to the head unit
// ---------------------------------------------------------------------------

/**
 * The head unit's answer to a change, made safe in the same way as the pushed state. Null when it is not a state at all (the change may
 * well have worked: the pushed state will show it).
 */
export function readFmState(raw: unknown): FmState | null {
  if (!isObj(raw) || typeof raw.status !== 'string') return null;
  const v = fmView(raw as unknown as FmState);
  return {
    mode: v.mode,
    status: v.status,
    on: v.on,
    acknowledged: v.acknowledged,
    frequency: v.frequency ?? FM_DEFAULT_FREQUENCY,
    presets: v.presets,
    level: v.level,
    board: v.board,
    limits: v.limits,
    detail: v.detail,
    demo: v.demo,
  };
}

export interface FmCalls {
  tune(frequency: number): Promise<FmState | null>;
  power(on: boolean): Promise<FmState | null>;
  /** Accepts the notice as it is worded in this version of the app. */
  acknowledge(): Promise<FmState | null>;
  preset(frequency: number, saved: boolean): Promise<FmState | null>;
}

const post = async (path: string, body: Record<string, unknown>): Promise<FmState | null> => readFmState(await apiRequest<unknown>(path, 'POST', body));

/** Each call resolves with the new state, or throws an ApiRequestError carrying the head unit's plain-language reason. */
export const fmCalls: FmCalls = {
  tune: (frequency) => post('/api/fm/tune', { frequency }),
  power: (on) => post('/api/fm/power', { on }),
  acknowledge: () => post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION }),
  preset: (frequency, saved) => post('/api/fm/preset', { frequency, saved }),
};

/**
 * A tap on the switch, carried out. Switching on before the notice has been accepted opens the notice (`openNotice`) and sends nothing:
 * the transmitter is only ever asked to start by a tap that comes after "I understand".
 */
export async function pressSwitch(v: FmView, calls: Pick<FmCalls, 'power'>, openNotice: () => void): Promise<FmState | null> {
  switch (switchPress(v)) {
    case 'notice':
      openNotice();
      return null;
    case 'on':
      return calls.power(true);
    case 'off':
      return calls.power(false);
    case 'none':
      return null;
  }
}

/**
 * "I understand": record that the notice was read, and only then switch on. If recording it fails, nothing is switched on. `onAcknowledged`
 * lets the screen close the notice as soon as it is recorded, even when switching on then fails (the reason is shown, and the notice
 * need not be read again).
 */
export async function acceptNoticeAndSwitchOn(calls: Pick<FmCalls, 'acknowledge' | 'power'>, onAcknowledged: (state: FmState | null) => void = () => {}): Promise<FmState | null> {
  onAcknowledged(await calls.acknowledge());
  return calls.power(true);
}

// ---------------------------------------------------------------------------
// Tuning without blipping across the band
// ---------------------------------------------------------------------------

export const TUNE_DELAY_MS = 450;

export interface FmTuner {
  /** Wait a moment before sending: a run of taps on + or - sends once, for where it ended. */
  set(frequency: number): void;
  /** Send now (a saved frequency is one jump). */
  now(frequency: number): void;
  /** Send what is waiting, if anything. */
  flush(): void;
}

/**
 * Taps on the step buttons arrive faster than a person can read the dial. While the transmitter is on the air, every frequency it is
 * told about is one it really sends on for a moment, so a run of taps is sent once, for the frequency it ends on, and not as a walk
 * through every station between. `onPending` reports the frequency being waited for (null once it is settled or failed), so the dial
 * can show it at once. A failure goes to `onError`, and the dial goes back to what the head unit says.
 */
export function createTuner(opts: { send(frequency: number): Promise<unknown>; onPending(frequency: number | null): void; onError(error: unknown): void; delayMs?: number }): FmTuner {
  const delay = opts.delayMs ?? TUNE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: number | null = null;
  let latest = 0;

  const fire = (frequency: number) => {
    const mine = ++latest;
    opts.onPending(frequency);
    void Promise.resolve()
      .then(() => opts.send(frequency))
      .catch((e: unknown) => opts.onError(e))
      // A newer tap while this one was in flight owns the dial now.
      .finally(() => {
        if (mine === latest && waiting === null) opts.onPending(null);
      });
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    stop();
    if (waiting === null) return;
    const f = waiting;
    waiting = null;
    fire(f);
  };
  return {
    set(frequency) {
      stop();
      waiting = frequency;
      latest += 1; // whatever is in flight is no longer the latest word
      opts.onPending(frequency);
      timer = setTimeout(flush, delay);
    },
    now(frequency) {
      stop();
      waiting = null;
      fire(frequency);
    },
    flush,
  };
}
