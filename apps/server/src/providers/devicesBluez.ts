import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BluetoothMediaState, DeviceCommand, DevicesState, PhoneDevice } from '@headunit/shared';
import { Observable } from '../observable';
import { lookupBluetoothArt } from './bluetoothArt';
import type { DevicesProvider } from './devices';

const run = promisify(execFile);

/** busctl's JSON wraps every D-Bus variant as {"type": "...", "data": ...}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (v: any): any => (v && typeof v === 'object' && !Array.isArray(v) && 'type' in v && 'data' in v ? v.data : v);

const DEVICE_PATH = /^\/org\/bluez\/hci\d+\/dev_[0-9A-F]{2}(_[0-9A-F]{2}){5}$/;
const PLAYER_PATH = /^\/org\/bluez\/hci\d+\/dev_([0-9A-F]{2}(?:_[0-9A-F]{2}){5})\/player\d+$/;
const APPLE_VENDOR = '004C';

type ManagedObjects = Record<string, Record<string, Record<string, unknown>>>;

function managedObjects(json: unknown): ManagedObjects | null {
  const top = unwrap(json);
  const objects = Array.isArray(top) ? top[0] : top;
  return objects && typeof objects === 'object' ? (objects as ManagedObjects) : null;
}

export interface ParsedDevice extends PhoneDevice {
  /** D-Bus object path, needed to connect/disconnect. */
  path: string;
}

/**
 * Turn the output of `busctl --json=short call org.bluez / …ObjectManager GetManagedObjects`
 * into phones. Only paired devices that look like phones are kept.
 */
export function parseManagedObjects(json: unknown): ParsedDevice[] {
  const objects = managedObjects(json);
  if (!objects) return [];
  const out: ParsedDevice[] = [];
  for (const [path, ifaces] of Object.entries(objects)) {
    const dev = ifaces?.['org.bluez.Device1'];
    if (!dev || !DEVICE_PATH.test(path)) continue;
    const get = (k: string) => unwrap(dev[k]);
    if (get('Paired') !== true) continue; // nearby-but-unpaired devices are noise

    const icon = String(get('Icon') ?? '');
    const cls = Number(get('Class') ?? 0);
    const isPhone = icon === 'phone' || ((cls >> 8) & 0x1f) === 2;
    if (!isPhone) continue;

    const vendor = /^(?:bluetooth|usb):v([0-9A-F]{4})/i.exec(String(get('Modalias') ?? ''))?.[1]?.toUpperCase();
    const connected = get('Connected') === true;
    const pct = unwrap(ifaces['org.bluez.Battery1']?.Percentage);
    out.push({
      id: String(get('Address') ?? path),
      path,
      name: String(get('Alias') ?? get('Name') ?? 'Phone'),
      platform: vendor === APPLE_VENDOR ? 'ios' : 'android',
      connected,
      active: false,
      // BlueZ only tells us about Bluetooth; Wi-Fi/USB come from the projection app.
      transports: connected ? ['bluetooth'] : [],
      ...(typeof pct === 'number' ? { battery: { percent: Math.max(0, Math.min(100, pct)) } } : {}),
      projection: null,
    });
  }
  return out.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}

interface ParsedPlayer {
  path: string;
  deviceId: string;
  media: BluetoothMediaState;
}

function parseMediaPlayers(json: unknown, names: Map<string, string>): ParsedPlayer[] {
  const objects = managedObjects(json);
  if (!objects) return [];
  const out: ParsedPlayer[] = [];
  for (const [path, ifaces] of Object.entries(objects)) {
    const player = ifaces?.['org.bluez.MediaPlayer1'];
    const m = PLAYER_PATH.exec(path);
    if (!player || !m) continue;
    const deviceId = m[1]!.replaceAll('_', ':');
    const get = (k: string) => unwrap(player[k]);
    const track = unwrap(get('Track')) as Record<string, unknown> | undefined;
    const tg = (k: string) => unwrap(track?.[k]);
    const statusRaw = String(get('Status') ?? 'stopped').toLowerCase();
    const status: BluetoothMediaState['status'] = statusRaw === 'playing' ? 'playing' : statusRaw === 'paused' ? 'paused' : statusRaw === 'stopped' ? 'stopped' : 'idle';
    const duration = Number(tg('Duration'));
    const position = Number(get('Position'));
    out.push({
      path,
      deviceId,
      media: {
        deviceId,
        deviceName: names.get(deviceId),
        status,
        ...(tg('Title') ? { title: String(tg('Title')) } : {}),
        ...(tg('Artist') ? { artist: String(tg('Artist')) } : {}),
        ...(tg('Album') ? { album: String(tg('Album')) } : {}),
        ...(Number.isFinite(duration) && duration > 0 ? { durationMs: duration } : {}),
        ...(Number.isFinite(position) && position >= 0 ? { positionMs: position } : {}),
      },
    });
  }
  return out;
}

export interface BluezOptions {
  /** `system` on the Pi; `user` lets tests talk to a private bus. */
  bus?: 'system' | 'user';
  env?: NodeJS.ProcessEnv;
  pollMs?: number;
  /** Override for tests. */
  exec?: (args: string[]) => Promise<string>;
}

/**
 * Real BlueZ phone integration plus AVRCP metadata/control and an A2DP-source loopback into the
 * Pi's default output. The loopback is best-effort: a phone that only exposes control/metadata
 * still remains usable and never takes the backend down.
 */
export function createBluezDevices(opts: BluezOptions = {}): DevicesProvider {
  const bus = `--${opts.bus ?? 'system'}`;
  const env = { ...process.env, ...opts.env };
  const exec =
    opts.exec ??
    (async (args: string[]) => {
      const { stdout } = await run('busctl', args, { env, timeout: 35_000 });
      return stdout;
    });

  const state = new Observable<DevicesState>({ source: 'bluez', devices: [] });
  let paths = new Map<string, string>();
  let activeId: string | null = null;
  let playerPath: string | null = null;
  let loopbackModule: string | null = null;
  let loopbackFor: string | null = null;
  let artKey = '';
  let artUrl: string | undefined;
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  const desktop = async (cmd: string, args: string[], timeout = 8000): Promise<string> => {
    const { stdout } = await run(cmd, args, { env, timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  };

  async function unloadLoopback() {
    if (!loopbackModule) return;
    const id = loopbackModule;
    loopbackModule = null;
    loopbackFor = null;
    await desktop('pactl', ['unload-module', id]).catch(() => undefined);
  }

  async function preferA2dp(id: string) {
    const card = `bluez_card.${id.replaceAll(':', '_')}`;
    // Profile names vary with the local/remote role and PipeWire version. Try the receive-audio names first.
    for (const profile of ['a2dp-source', 'a2dp_source', 'a2dp-sink', 'a2dp_sink']) {
      try {
        await desktop('pactl', ['set-card-profile', card, profile], 5000);
        return;
      } catch {
        // keep trying
      }
    }
  }

  async function findPhoneSource(id: string): Promise<string | null> {
    try {
      const text = await desktop('pactl', ['list', 'short', 'sources']);
      const needle = id.replaceAll(':', '_').toLowerCase();
      for (const line of text.split('\n')) {
        const cols = line.trim().split(/\s+/);
        const name = cols[1] ?? '';
        if (name.toLowerCase().includes('bluez_input') && name.toLowerCase().includes(needle)) return name;
      }
    } catch {
      // pipewire-pulse/pactl unavailable
    }
    return null;
  }

  async function ensureLoopback(id: string): Promise<boolean> {
    if (loopbackModule && loopbackFor === id) return true;
    if (loopbackModule && loopbackFor !== id) await unloadLoopback();
    const source = await findPhoneSource(id);
    if (!source) return false;
    try {
      const out = await desktop('pactl', [
        'load-module',
        'module-loopback',
        `source=${source}`,
        'latency_msec=120',
        'adjust_time=1',
        'source_dont_move=true',
      ]);
      const module = out.trim().split(/\s+/)[0];
      if (!module) return false;
      loopbackModule = module;
      loopbackFor = id;
      return true;
    } catch {
      return false;
    }
  }

  async function readCodec(id: string): Promise<string | undefined> {
    try {
      const text = await desktop('pw-dump', [], 7000);
      const dump = JSON.parse(text) as any[];
      const node = dump.find((o) => {
        const p = o?.info?.props;
        return p?.['api.bluez5.address'] === id && typeof p?.['api.bluez5.codec'] === 'string';
      });
      const codec = node?.info?.props?.['api.bluez5.codec'];
      return typeof codec === 'string' && codec ? codec : undefined;
    } catch {
      return undefined;
    }
  }

  function refreshArt(media: BluetoothMediaState | undefined) {
    const key = media ? [media.title ?? '', media.artist ?? '', media.album ?? ''].join('|') : '';
    if (!media || !key.replaceAll('|', '')) {
      artKey = '';
      artUrl = undefined;
      return;
    }
    if (key === artKey) return;
    artKey = key;
    artUrl = undefined;
    void lookupBluetoothArt(media.title, media.artist, media.album).then((url) => {
      if (artKey !== key || !url) return;
      artUrl = url;
      const cur = state.get();
      if (cur.media && [cur.media.title ?? '', cur.media.artist ?? '', cur.media.album ?? ''].join('|') === key) {
        state.set({ ...cur, media: { ...cur.media, artUrl: url } });
      }
    });
  }

  async function refresh() {
    try {
      const out = await exec([bus, '--json=short', 'call', 'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects']);
      const json = JSON.parse(out);
      const parsed = parseManagedObjects(json);
      paths = new Map(parsed.map((d) => [d.id, d.path]));
      const connected = parsed.filter((d) => d.connected);
      if (!activeId || !connected.some((d) => d.id === activeId)) activeId = connected[0]?.id ?? null;

      const names = new Map(parsed.map((d) => [d.id, d.name]));
      const players = parseMediaPlayers(json, names);
      const chosen = players.find((p) => p.deviceId === activeId) ?? players.find((p) => connected.some((d) => d.id === p.deviceId)) ?? players[0];
      playerPath = chosen?.path ?? null;
      let media = chosen?.media;

      if (activeId) {
        const [routed, codec] = await Promise.all([ensureLoopback(activeId), readCodec(activeId)]);
        if (media) media = { ...media, routed, ...(codec ? { codec } : {}), ...(artUrl ? { artUrl } : {}) };
      } else {
        await unloadLoopback();
      }
      refreshArt(media);
      if (media && artUrl) media = { ...media, artUrl };

      state.set({
        source: 'bluez',
        devices: parsed.map(({ path: _p, ...d }) => ({ ...d, active: d.id === activeId })),
        ...(media ? { media } : {}),
      });
    } catch (err) {
      const msg = (err as Error).message.split('\n')[0] ?? 'unknown error';
      state.set({ source: 'bluez', devices: [], error: `Bluetooth unavailable: ${msg}` });
    }
  }

  async function call(id: string, method: 'Connect' | 'Disconnect') {
    const path = paths.get(id);
    if (!path || !DEVICE_PATH.test(path)) throw new Error(`Unknown device ${id}`);
    await exec([bus, 'call', 'org.bluez', path, 'org.bluez.Device1', method]);
  }

  async function mediaCommand(action: Extract<DeviceCommand, { cmd: 'media' }>['action']) {
    if (!playerPath || !PLAYER_PATH.test(playerPath)) throw new Error('Phone media controls are not available yet');
    const current = state.get().media?.status;
    const method = action === 'toggle' ? (current === 'playing' ? 'Pause' : 'Play') : action === 'play' ? 'Play' : action === 'pause' ? 'Pause' : action === 'next' ? 'Next' : 'Previous';
    await exec([bus, 'call', 'org.bluez', playerPath, 'org.bluez.MediaPlayer1', method]);
  }

  return {
    state,

    async command(c: DeviceCommand) {
      try {
        if (c.cmd === 'media') await mediaCommand(c.action);
        else if (c.cmd === 'connect') {
          await call(c.id, 'Connect');
          activeId = c.id;
          await preferA2dp(c.id);
        } else if (c.cmd === 'disconnect') {
          if (loopbackFor === c.id) await unloadLoopback();
          await call(c.id, 'Disconnect');
          if (activeId === c.id) activeId = null;
        } else {
          // One phone owns audio/calls at a time: bring this one up, release the others.
          const others = state.get().devices.filter((d) => d.connected && d.id !== c.id);
          for (const o of others) await call(o.id, 'Disconnect').catch(() => {});
          await call(c.id, 'Connect');
          activeId = c.id;
          await preferA2dp(c.id);
        }
      } catch (err) {
        state.update({ error: `Couldn't ${c.cmd}: ${(err as Error).message.split('\n')[0]}` });
        return;
      }
      // Give BlueZ/PipeWire a brief moment to create the A2DP source before re-reading state.
      if (c.cmd !== 'media') await new Promise((r) => setTimeout(r, 400));
      await refresh();
    },

    start() {
      if (running) return;
      running = true;
      const loop = async () => {
        await refresh();
        if (running) {
          timer = setTimeout(loop, opts.pollMs ?? 4000);
          timer.unref();
        }
      };
      void loop();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      void unloadLoopback();
    },
  };
}
