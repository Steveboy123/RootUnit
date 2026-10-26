import { inspect } from 'node:util';
import { FM_DEFAULT_AUDIO_PORT, FM_DEFAULT_CONTROL_PORT, type FmMode } from '@headunit/shared';

/**
 * The FM helper's password. It prints as stars whatever is done with it (console.log, JSON.stringify, a template string), so it cannot
 * end up in a log line, a state object or an error message by accident. Only `reveal()` gives it out, and only the two places that must
 * send it (the control request and the first line of the sound connection) call that.
 */
export class FmSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '***';
  }

  toJSON(): string {
    return '***';
  }

  [inspect.custom](): string {
    return 'FmSecret(***)';
  }
}

/** Where the FM helper is and how to talk to it. Read from the environment only: never from settings.json, so never in a backup. */
export interface FmConfig {
  /** `none`: not set up (or set up wrongly, see `problem`). `local`: the helper is on this Pi. `remote`: on a second Pi. */
  mode: FmMode;
  /** One plain sentence about the line in .env to fix, when something is set but cannot be used. Null otherwise. */
  problem: string | null;
  token: FmSecret | null;
  /** The helper's host for the sound connection (no brackets around an IPv6 address). */
  host: string;
  /** `http://host:port`, no path: the helper's control address. */
  controlUrl: string;
  audioPort: number;
  /** What parec records: the monitor of the default output, so whatever the head unit plays is what goes on the air. */
  audioSource: string;
}

export const DEFAULT_AUDIO_SOURCE = '@DEFAULT_MONITOR@';

export const FM_NO_CONFIG: FmConfig = { mode: 'none', problem: null, token: null, host: '', controlUrl: '', audioPort: FM_DEFAULT_AUDIO_PORT, audioSource: DEFAULT_AUDIO_SOURCE };

/** The helper refuses anything under 16 characters. At most 100, so `AUDIO 1 <token>\n` stays inside the 128 bytes the helper reads. */
const TOKEN_RE = /^[\x21-\x7e]{16,100}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const problem = (text: string): FmConfig => ({ ...FM_NO_CONFIG, problem: text });

const isLoopback = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);
};

/**
 * `FM_NODE_TOKEN`, `FM_NODE_URL`, `FM_NODE_AUDIO_PORT` and `FM_AUDIO_SOURCE` from the environment. Never throws: a line that cannot be used
 * leaves the transmitter "not set up" with a sentence saying which line to fix (the value itself is never repeated: it may be the password).
 */
export function readFmConfig(env: Readonly<Record<string, string | undefined>>): FmConfig {
  const token = (env.FM_NODE_TOKEN ?? '').trim();
  const urlText = (env.FM_NODE_URL ?? '').trim();
  if (!token) return urlText ? problem('FM_NODE_URL is set but FM_NODE_TOKEN is empty. Add the password of the FM helper as FM_NODE_TOKEN.') : FM_NO_CONFIG;
  if (!TOKEN_RE.test(token)) return problem('FM_NODE_TOKEN must be 16 to 100 letters, digits or symbols, with no spaces. Copy it from the setup of the FM helper.');

  const raw = urlText || `http://127.0.0.1:${FM_DEFAULT_CONTROL_PORT}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return problem('FM_NODE_URL is not an address. Write it like http://192.168.1.50:8788');
  }
  if (url.protocol !== 'http:') return problem('FM_NODE_URL must start with http:// (the FM helper does not use https). Example: http://192.168.1.50:8788');
  if (url.username || url.password) return problem('FM_NODE_URL must not contain a user name or password. The password goes in FM_NODE_TOKEN.');
  if (!url.hostname || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return problem('FM_NODE_URL must be only the address and port. Example: http://192.168.1.50:8788');

  // `new URL` drops an explicit :80, so the port is read from the text. No port at all means the helper's own default.
  const explicit = /^http:\/\/(?:\[[^\]]*\]|[^/:?#]*):(\d+)/i.exec(raw);
  const controlPort = explicit ? Number(explicit[1]) : FM_DEFAULT_CONTROL_PORT;
  if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535) return problem('FM_NODE_URL has a port that is not between 1 and 65535.');

  const audioText = (env.FM_NODE_AUDIO_PORT ?? '').trim();
  const audioPort = audioText === '' ? FM_DEFAULT_AUDIO_PORT : /^\d{1,5}$/.test(audioText) ? Number(audioText) : NaN;
  if (!Number.isInteger(audioPort) || audioPort < 1 || audioPort > 65535) return problem('FM_NODE_AUDIO_PORT must be a port number between 1 and 65535.');

  const audioSource = (env.FM_AUDIO_SOURCE ?? '').trim() || DEFAULT_AUDIO_SOURCE;
  if (audioSource.length > 200 || CONTROL_CHARS.test(audioSource)) return problem('FM_AUDIO_SOURCE is not a sound source name. Leave it empty to use what the head unit is playing.');

  const hostname = url.hostname;
  return {
    mode: isLoopback(hostname) ? 'local' : 'remote',
    problem: null,
    token: new FmSecret(token),
    host: hostname.startsWith('[') ? hostname.slice(1, -1) : hostname,
    controlUrl: `http://${hostname}:${controlPort}`,
    audioPort,
    audioSource,
  };
}

/** Removes the password from a piece of text, wherever it might have come from (a helper's error message, a library's). */
export function scrubSecret(text: string, token: FmSecret | null): string {
  const t = token?.reveal();
  return t ? text.split(t).join('***') : text;
}
