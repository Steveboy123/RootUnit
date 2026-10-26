import type { ClientMessage, DeviceCommand, MediaCommand, RadioCommand, RepeatMode, SystemPatch } from '@headunit/shared';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** undefined = not given, null = invalid. */
const offsetOf = (v: unknown): number | undefined | null =>
  v === undefined ? undefined : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000 ? v : null;

function parseMediaCommand(c: unknown): MediaCommand | null {
  if (!isObj(c) || typeof c.cmd !== 'string') return null;
  switch (c.cmd) {
    case 'play':
    case 'pause':
    case 'toggle':
    case 'next':
    case 'prev':
      return { cmd: c.cmd };
    case 'seek':
      return finite(c.positionMs) ? { cmd: 'seek', positionMs: c.positionMs } : null;
    case 'volume':
      return finite(c.volume) ? { cmd: 'volume', volume: c.volume } : null;
    case 'shuffle':
      return typeof c.enabled === 'boolean' ? { cmd: 'shuffle', enabled: c.enabled } : null;
    case 'repeat':
      return c.mode === 'off' || c.mode === 'track' || c.mode === 'context'
        ? { cmd: 'repeat', mode: c.mode as RepeatMode }
        : null;
    case 'playContext': {
      if (typeof c.uri !== 'string' || c.uri.length >= 200) return null;
      const off = offsetOf(c.offset);
      return off === null ? null : { cmd: 'playContext', uri: c.uri, ...(off !== undefined ? { offset: off } : {}) };
    }
    case 'playTracks': {
      if (!Array.isArray(c.uris) || c.uris.length === 0 || c.uris.length > 100) return null;
      if (!c.uris.every((u) => typeof u === 'string' && u.length < 200)) return null;
      const off = offsetOf(c.offset);
      return off === null ? null : { cmd: 'playTracks', uris: c.uris as string[], ...(off !== undefined ? { offset: off } : {}) };
    }
    case 'queueAdd':
      return typeof c.uri === 'string' && c.uri.length < 200 ? { cmd: 'queueAdd', uri: c.uri } : null;
    default:
      return null;
  }
}

const ID = /^[\w:.-]{1,64}$/;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function parseDeviceCommand(c: unknown): DeviceCommand | null {
  if (!isObj(c) || typeof c.cmd !== 'string') return null;
  if (c.cmd === 'media') {
    if (c.action !== 'toggle' && c.action !== 'play' && c.action !== 'pause' && c.action !== 'next' && c.action !== 'prev') return null;
    if (c.id === undefined) return { cmd: 'media', action: c.action };
    return str(c.id, 64) && ID.test(c.id) ? { cmd: 'media', action: c.action, id: c.id } : null;
  }
  if (!str(c.id, 64) || !ID.test(c.id)) return null;
  return c.cmd === 'activate' || c.cmd === 'connect' || c.cmd === 'disconnect' ? { cmd: c.cmd, id: c.id } : null;
}

function parseRadioCommand(c: unknown): RadioCommand | null {
  if (!isObj(c) || typeof c.cmd !== 'string') return null;
  switch (c.cmd) {
    case 'play':
      return c.id === undefined ? { cmd: 'play' } : str(c.id, 64) && ID.test(c.id) ? { cmd: 'play', id: c.id } : null;
    case 'stop':
    case 'toggle':
    case 'next':
    case 'prev':
      return { cmd: c.cmd };
    case 'favorite':
      return str(c.id, 64) && ID.test(c.id) && typeof c.on === 'boolean' ? { cmd: 'favorite', id: c.id, on: c.on } : null;
    case 'remove':
      return str(c.id, 64) && ID.test(c.id) ? { cmd: 'remove', id: c.id } : null;
    case 'add':
      if (!str(c.name, 80) || !str(c.url, 2048)) return null;
      return {
        cmd: 'add',
        name: c.name,
        url: c.url,
        ...(str(c.genre, 60) ? { genre: c.genre } : {}),
        ...(str(c.logo, 2048) ? { logo: c.logo } : {}),
      };
    default:
      return null;
  }
}

function parseSystemPatch(p: unknown): SystemPatch | null {
  if (!isObj(p)) return null;
  const out: SystemPatch = {};
  if (finite(p.output) && Number.isInteger(p.output) && p.output >= 0 && p.output < 1_000_000) out.output = p.output;
  if (finite(p.volume)) out.volume = Math.max(0, Math.min(100, Math.round(p.volume)));
  if (typeof p.muted === 'boolean') out.muted = p.muted;
  if (finite(p.brightness)) out.brightness = Math.max(5, Math.min(100, Math.round(p.brightness)));
  return out;
}

/** Strictly validate a raw WebSocket frame. Anything unexpected → null (dropped). */
export function parseClientMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'media': {
      const command = parseMediaCommand(m.command);
      return command ? { t: 'media', command } : null;
    }
    case 'system': {
      const patch = parseSystemPatch(m.patch);
      return patch ? { t: 'system', patch } : null;
    }
    case 'settings':
      return isObj(m.patch) ? { t: 'settings', patch: m.patch } : null;
    case 'layout':
      // Deep validation happens in sanitizeLayout().
      return isObj(m.data) ? { t: 'layout', data: m.data as never } : null;
    case 'projection':
      return m.command === 'launch' || m.command === 'stop' ? { t: 'projection', command: m.command } : null;
    case 'android-auto-dev':
      return m.command === 'refresh' || m.command === 'connect' || m.command === 'disconnect'
        ? { t: 'android-auto-dev', command: m.command }
        : null;
    case 'device': {
      const command = parseDeviceCommand(m.command);
      return command ? { t: 'device', command } : null;
    }
    case 'radio': {
      const command = parseRadioCommand(m.command);
      return command ? { t: 'radio', command } : null;
    }
    case 'diagnostics':
      return m.command === 'read' || m.command === 'clear' ? { t: 'diagnostics', command: m.command } : null;
    case 'camera':
      return m.command === 'show' || m.command === 'hide' || m.command === 'toggle' ? { t: 'camera', command: m.command } : null;
    default:
      return null;
  }
}
