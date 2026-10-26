/**
 * Customisable navigation over the real WebSocket: a patch to the rail, the launcher or the Quick Panel is merged by the server, saved,
 * passed to the other screens, and, if the server had to correct it, sent back to the screen that wrote it. Also: the size limit on
 * a frame, and a backup that goes out of one running server and into another.
 *
 * (The app is booted the way features/routes.test.ts boots it: the real createApp with the simulated hardware, on a free port.)
 */
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_LAYOUT, DEFAULT_LAUNCHER, DEFAULT_NAV, DEFAULT_PANEL, DEFAULT_SETTINGS, NAV_PRESETS, sanitizeSettings, type DashboardLayout, type Settings } from '@headunit/shared';
import { config } from './config';
import { createMusic } from './connections/music';
import { createSimDevices } from './demo/devicesSim';
import { createMockMedia } from './demo/mediaMock';
import { createMockProjection } from './demo/projection';
import { createSimSystem } from './demo/system';
import { createVehicleSim } from './demo/vehicleSim';
import { Observable } from './observable';
import { createCamera } from './providers/camera';
import { createRadio } from './radio/radio';
import { createApp } from './server';
import { JsonStore } from './store';

let dir: string;
let closers: Array<() => void> = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nav-'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined); // the server says so when it refuses a layout; the tests do that on purpose
});
afterEach(async () => {
  for (const c of closers.splice(0)) c();
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function boot(opts: { settings?: Partial<Settings>; layout?: DashboardLayout } = {}) {
  const store = new JsonStore(dir);
  const settings = new Observable<Settings>({ ...DEFAULT_SETTINGS, ...opts.settings });
  const layout = new Observable(opts.layout ?? DEFAULT_LAYOUT);
  const music = createMusic({ store, settings, config });
  closers.push(() => music.dispose());
  const app = createApp({
    config: { ...config, dataDir: dir, sensorToken: 'sensor-secret', updater: { ...config.updater, downloadDir: join(dir, 'Downloads') } },
    store,
    vehicle: createVehicleSim(),
    media: createMockMedia(),
    connections: music.connections,
    system: createSimSystem(),
    projection: createMockProjection(),
    devices: createSimDevices(),
    radio: createRadio({ store }),
    camera: createCamera(),
    settings,
    layout,
    fetch: (async () => {
      throw new Error('offline');
    }) as typeof fetch,
  });
  await app.features.start();
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  closers.push(() => app.close());
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return { app, store, settings, layout, port, base, dir };
}
type Server = Awaited<ReturnType<typeof boot>>;

type Message = { t: string; data?: Record<string, unknown> } & Record<string, unknown>;

/** A screen: a WebSocket that remembers everything it was sent. */
async function connect(s: Server) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: s.base } });
  const messages: Message[] = [];
  let closed: { code: number } | null = null;
  ws.on('message', (d) => messages.push(JSON.parse(d.toString()) as Message));
  ws.on('close', (code) => (closed = { code }));
  ws.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  closers.push(() => ws.terminate());
  await vi.waitFor(() => expect(messages.some((m) => m.t === 'snapshot')).toBe(true));
  const count = (t: string) => messages.filter((m) => m.t === t).length;
  const screen = {
    ws,
    messages,
    count,
    get closed() {
      return closed;
    },
    settingsMessages: () => messages.filter((m) => m.t === 'settings').map((m) => m.data as unknown as Settings),
    patch: (patch: unknown) => ws.send(JSON.stringify({ t: 'settings', patch })),
    raw: (text: string) => ws.send(text),
    /**
     * Wait until the server has handled everything this screen sent before. An invalid layout makes the server answer with a fresh snapshot,
     * and a screen's messages are handled and answered in order, so once that snapshot is here, any reply to an earlier message is here too.
     */
    async fence() {
      const before = count('snapshot');
      ws.send(JSON.stringify({ t: 'layout', data: { version: 99 } }));
      await vi.waitFor(() => expect(count('snapshot')).toBe(before + 1));
    },
  };
  return screen;
}

const GARBAGE_NAV = {
  version: 1,
  position: 'upside-down',
  size: 5,
  labels: null,
  items: [{ id: 'x', to: { kind: 'nope' } }, 7, null, { to: { kind: 'route', route: '__proto__' } }, { to: { kind: 'page', page: 'p-1' } }],
};

/** What is on disk once the server has written it. */
async function onDisk(s: Server): Promise<unknown> {
  await s.store.flush();
  return s.store.read('settings.json');
}

describe('a patch to the rail, the launcher or the Quick Panel', () => {
  it('21. a garbage nav leaves every other setting alone, is saved sanitized, and the sender is sent the corrected settings', async () => {
    const s = await boot({ settings: { theme: 'ember', units: 'imperial', accent: '#ff8800', nav: { ...DEFAULT_NAV, position: 'right' } } });
    const sender = await connect(s);
    const before = s.settings.get();

    sender.patch({ nav: GARBAGE_NAV });
    await vi.waitFor(() => expect(sender.count('settings')).toBe(1));

    // the server: position/size/labels that were invalid keep the stored values; the garbage list became the default rail
    const after = s.settings.get();
    expect(after.nav).toEqual({ ...DEFAULT_NAV, position: 'right' });
    expect({ ...after, nav: null }).toEqual({ ...before, nav: null }); // nothing else moved
    // the sender is told what the server kept
    expect(sender.settingsMessages()[0]).toEqual(after);
    // and it is on disk that way, not as sent
    expect(await onDisk(s)).toEqual(JSON.parse(JSON.stringify(after)));
    expect(JSON.stringify(await onDisk(s))).not.toContain('upside-down');
    expect(JSON.stringify(await onDisk(s))).not.toContain('nope');
    // a screen that connects later gets the same
    const late = await connect(s);
    expect((late.messages.find((m) => m.t === 'snapshot') as unknown as { settings: Settings }).settings).toEqual(after);
  });

  it('a repaired rail (a list the server had to fix) is sent back, and what comes back is a valid rail', async () => {
    const s = await boot();
    const sender = await connect(s);
    sender.patch({ nav: { version: 1, items: [{ id: 'BAD ID', to: { kind: 'app', app: 'gps' } }, { id: 'bbbb', to: { kind: 'app', app: 'gps' } }, { id: 'cccc', to: { kind: 'route', route: 'drive' } }] } });
    await vi.waitFor(() => expect(sender.count('settings')).toBe(1));
    const nav = sender.settingsMessages()[0]!.nav;
    expect(nav.items.map((i) => i.id)).toEqual(['item1', 'cccc', 'spacer', 'settings']);
    expect(nav).toEqual(s.settings.get().nav);
  });

  it('a clean patch is applied and passed to the other screens, but the sender gets nothing back', async () => {
    const s = await boot();
    const sender = await connect(s);
    const other = await connect(s);

    const clean = { nav: { version: 1, position: 'right', size: 'large', items: JSON.parse(JSON.stringify(NAV_PRESETS.minimal.items)) }, launcher: { version: 1, hidden: ['gps'] }, panel: { version: 1, tiles: ['bt'], sections: { sleep: false } } };
    sender.patch(clean);
    await vi.waitFor(() => expect(other.count('settings')).toBe(1));
    await sender.fence();

    const next = s.settings.get();
    expect(next.nav).toEqual({ ...NAV_PRESETS.minimal, position: 'right', size: 'large', labels: 'always' });
    expect(next.launcher.hidden).toEqual(['gps']);
    expect(next.panel).toEqual({ ...DEFAULT_PANEL, tiles: ['bt'], sections: { scenes: true, actions: true, sleep: false } });
    expect(other.settingsMessages()[0]).toEqual(next);
    expect(sender.count('settings')).toBe(0); // nothing came back
  });

  it('another connected screen gets the broadcast of a corrected patch too, with the corrected value', async () => {
    const s = await boot();
    const sender = await connect(s);
    const other = await connect(s);
    sender.patch({ nav: GARBAGE_NAV, launcher: { version: 1, hidden: ['gps', 'BAD!', 'gps'] } });
    await vi.waitFor(() => expect(other.count('settings')).toBe(1));
    await vi.waitFor(() => expect(sender.count('settings')).toBe(1));
    expect(other.settingsMessages()[0]).toEqual(s.settings.get());
    expect(sender.settingsMessages()[0]).toEqual(s.settings.get());
    expect(s.settings.get().launcher.hidden).toEqual(['gps']);
  });

  it('only a patch that was changed is sent back: launcher, panel and the refused ones', async () => {
    const s = await boot();
    const c = await connect(s);
    const expectEchoes = async (patch: unknown, echoes: number) => {
      const before = c.count('settings');
      c.patch(patch);
      await c.fence();
      expect(c.count('settings') - before, JSON.stringify(patch)).toBe(echoes);
    };
    await expectEchoes({ launcher: { version: 1, hidden: ['gps', 'perf'] } }, 0);
    await expectEchoes({ launcher: { version: 1, hidden: ['gps', 'Not Valid', 'perf'] } }, 1);
    await expectEchoes({ launcher: { hidden: ['findcar'] } }, 1); // no version: refused, and the sender is told
    await expectEchoes({ panel: { version: 1, tiles: ['bt', 'camera'] } }, 0);
    await expectEchoes({ panel: { version: 1, tiles: ['bt', 'bt'] } }, 1);
    await expectEchoes({ panel: { version: 1, sections: { scenes: false } } }, 0); // a partial sections patch is not a correction
    await expectEchoes({ panel: { version: 1, sections: { scenes: 'maybe' } } }, 1);
    await expectEchoes({ nav: { version: 1, position: 'left' } }, 0);
    await expectEchoes({ nav: { version: 1, position: 'bottom' } }, 1);
    await expectEchoes({ nav: { version: 2, position: 'right' } }, 1);
    await expectEchoes({ nav: { position: 'right' } }, 1);
    await expectEchoes({ nav: 'right' }, 1);
    await expectEchoes({ nav: { version: 1 } }, 0);
    // keys outside the three arrangements are not part of this: the other settings are as before
    await expectEchoes({ theme: 'ember' }, 0);
    await expectEchoes({ theme: 'not-a-theme' }, 0);
    expect(s.settings.get().theme).toBe('ember');
  });

  it('a patch with the object keys in another order is still clean', async () => {
    const s = await boot();
    const c = await connect(s);
    c.patch({ nav: { items: [{ to: { route: 'home', kind: 'route' }, id: 'home' }, { to: { kind: 'gap' }, id: 'spacer' }, { to: { route: 'settings', kind: 'route' }, id: 'settings' }], version: 1 } });
    await c.fence();
    expect(c.count('settings')).toBe(0);
    expect(s.settings.get().nav.items).toHaveLength(3);
  });

  it('a stream of patches is handled in order; the last one wins; every correction reaches the sender', async () => {
    const s = await boot();
    const c = await connect(s);
    c.patch({ nav: { version: 1, position: 'right' } });
    c.patch({ nav: { version: 1, size: 'giant' } });
    c.patch({ nav: { version: 1, size: 'compact' } });
    c.patch({ nav: { version: 1, items: [{}] } });
    c.patch({ nav: { version: 1, position: 'left' } });
    await c.fence();
    expect(s.settings.get().nav).toEqual({ ...DEFAULT_NAV, position: 'left', size: 'compact' });
    expect(c.count('settings')).toBe(2); // the invalid size, and the list that was garbage
    expect(c.settingsMessages()[0]!.nav.position).toBe('right');
    expect(c.settingsMessages()[1]!.nav.size).toBe('compact');
  });

  it('survives prototype-pollution payloads sent as raw text, and keeps every other key', async () => {
    const s = await boot({ settings: { theme: 'ember' } });
    const c = await connect(s);
    const protoKeys = Object.getOwnPropertyNames(Object.prototype).sort();
    c.raw('{"t":"settings","patch":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nav":{"version":1,"__proto__":{"polluted":true,"items":[]},"items":[{"id":"constructor","to":{"kind":"app","app":"constructor"},"__proto__":{"polluted":true}}]},"launcher":{"version":1,"hidden":["__proto__","constructor"],"__proto__":{"hidden":["x"]}},"panel":{"version":1,"tiles":["__proto__"],"sections":{"__proto__":{"scenes":false}}}}}');
    await c.fence();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(protoKeys);
    const next = s.settings.get();
    expect(Object.keys(next).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(next.theme).toBe('ember');
    expect(next.nav.items.map((i) => i.id)).toEqual(['constructor', 'spacer', 'settings']);
    expect(next.launcher.hidden).toEqual(['constructor']);
    expect(next.panel).toEqual(DEFAULT_PANEL); // tiles of nothing but junk: the stored tiles stay; sections is a plain object with no usable key
    expect(JSON.stringify(await onDisk(s))).not.toContain('polluted');
  });

  it('refuses frames that are not messages without disturbing the settings or the connection', async () => {
    const s = await boot();
    const c = await connect(s);
    for (const text of ['not json', '[]', '5', 'null', '{"t":"settings"}', '{"t":"settings","patch":[]}', '{"t":"settings","patch":5}', '{"t":"settings","patch":null}', '{"t":"nope"}']) c.raw(text);
    await c.fence();
    expect(s.settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(c.closed).toBeNull();
    expect(c.count('settings')).toBe(0);
  });

  it('a listener of the settings that throws is logged, and neither the connection nor the server is lost', async () => {
    const s = await boot();
    const c = await connect(s);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const off = s.settings.subscribe(() => {
      throw new Error('a feature has a bug');
    });
    c.patch({ theme: 'ember' });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[settings] could not apply a patch from a screen:', expect.any(Error)));
    off();
    c.patch({ nav: { version: 1, position: 'right' } });
    await c.fence();
    expect(s.settings.get().nav.position).toBe('right');
    expect(c.closed).toBeNull();
  });

  it('the settings on disk load again as they were saved (a restart keeps the rail)', async () => {
    const s = await boot();
    const c = await connect(s);
    c.patch({ nav: { version: 1, position: 'right', labels: 'active', items: [{ id: 'aaaa', to: { kind: 'app', app: 'gps' }, label: 'Maps', icon: 'map' }, { id: 'bbbb', to: { kind: 'music', tab: 'tidal' } }] } });
    await c.fence();
    const saved = await onDisk(s);
    expect(sanitizeSettings(saved)).toEqual(s.settings.get());
    expect(sanitizeSettings(saved).nav.items[0]).toEqual({ id: 'aaaa', to: { kind: 'app', app: 'gps' }, label: 'Maps', icon: 'map' });
  });
});

describe('the size limit on a frame', () => {
  /** About the biggest layout the editor can make: twelve pages of forty-eight widgets, each with a few settings. */
  function biggestLayout(): DashboardLayout {
    return {
      version: 1,
      pages: Array.from({ length: 12 }, (_, p) => ({
        id: `page${p}`,
        name: `Page ${p}`,
        widgets: Array.from({ length: 48 }, (_, w) => ({ id: `w-${p}-${w}-abcdef`, type: 'launcher', x: w % 12, y: Math.floor(w / 12), w: 1, h: 1, config: { note: 'x'.repeat(70), n: w, on: w % 2 === 0 } })),
      })),
    };
  }

  it('a layout of about 100 KB, the largest the editor can make, still goes through', async () => {
    const s = await boot();
    const a = await connect(s);
    const b = await connect(s);
    const layout = biggestLayout();
    const text = JSON.stringify({ t: 'layout', data: layout });
    expect(text.length).toBeGreaterThan(90_000);
    expect(text.length).toBeLessThan(256 * 1024);
    a.ws.send(text);
    await vi.waitFor(() => expect(b.count('layout')).toBe(1));
    expect(s.layout.get().pages).toHaveLength(12);
    expect(s.layout.get().pages[11]?.widgets).toHaveLength(48);
    expect(a.closed).toBeNull();
  });

  it('the largest possible settings patch is a small part of the limit', () => {
    const worst = JSON.stringify({ t: 'settings', patch: { nav: { version: 1, position: 'right', size: 'large', labels: 'active', items: Array.from({ length: 40 }, (_, i) => ({ id: `${'i'.repeat(23)}${i % 10}`, to: { kind: 'app', app: 'x'.repeat(32) }, label: '\u{1F600}'.repeat(10), icon: 'thermometer' })) }, launcher: { version: 1, hidden: Array.from({ length: 32 }, () => 'y'.repeat(32)) } } });
    expect(Buffer.byteLength(worst)).toBeLessThan(16 * 1024);
  });

  it('an oversize frame is refused: that connection is closed (code 1009), nothing changes, and the server and the other screens carry on', async () => {
    const s = await boot();
    const abuser = await connect(s);
    const bystander = await connect(s);
    const before = s.settings.get();

    // a settings patch padded far past the limit: if it were read, the label would be accepted (cut to ten characters)
    abuser.raw(JSON.stringify({ t: 'settings', patch: { theme: 'ember', nav: { version: 1, items: [{ id: 'aaaa', to: { kind: 'route', route: 'home' }, label: 'Big'.padEnd(300 * 1024, 'x') }] } } }));
    await vi.waitFor(() => expect(abuser.closed).not.toBeNull());
    expect(abuser.closed?.code).toBe(1009);
    expect(s.settings.get()).toEqual(before);

    // the other screen is still connected, and the server still takes patches and still lets new screens in
    expect(bystander.closed).toBeNull();
    const fresh = await connect(s);
    fresh.patch({ nav: { version: 1, position: 'right' } });
    await vi.waitFor(() => expect(bystander.count('settings')).toBe(1));
    expect(s.settings.get().nav.position).toBe('right');
    expect(bystander.settingsMessages()[0]?.nav.position).toBe('right');
  });

  it('an oversize layout is refused too and the saved layout is not touched', async () => {
    const s = await boot();
    const a = await connect(s);
    const huge = biggestLayout();
    for (const page of huge.pages) for (const w of page.widgets) w.config = { note: 'x'.repeat(400) };
    const text = JSON.stringify({ t: 'layout', data: huge });
    expect(text.length).toBeGreaterThan(256 * 1024);
    a.ws.send(text);
    await vi.waitFor(() => expect(a.closed?.code).toBe(1009));
    expect(s.layout.get()).toEqual(DEFAULT_LAYOUT);
    const b = await connect(s);
    expect(b.count('snapshot')).toBe(1);
  });
});

describe('a backup that carries the rail, from one running server to another', () => {
  async function backupOf(s: Server): Promise<{ app: string; version: number; data: { settings: Record<string, unknown> } }> {
    const res = await fetch(`${s.base}/api/backup`);
    expect(res.status).toBe(200);
    return (await res.json()) as { app: string; version: number; data: { settings: Record<string, unknown> } };
  }
  const restore = (s: Server, bundle: unknown) => fetch(`${s.base}/api/backup/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle }) });

  it('a custom rail, launcher and panel go out in the backup and come back exactly, dangling references and all', async () => {
    const a = await boot();
    const sender = await connect(a);
    sender.patch({
      nav: { version: 1, position: 'right', items: [{ id: 'aaaa', to: { kind: 'app', app: 'app-from-the-future' } }, { id: 'bbbb', to: { kind: 'scene', scene: 'goneaway' } }, { id: 'cccc', to: { kind: 'action', action: 'garage01' } }, { id: 'dddd', to: { kind: 'route', route: 'drive' }, label: 'Go' }] },
      launcher: { version: 1, hidden: ['ghost-app'] },
      panel: { version: 1, tiles: ['camera'], sections: { actions: false } },
    });
    await sender.fence();
    const saved = a.settings.get();
    const bundle = await backupOf(a);
    expect(bundle.data.settings.nav).toEqual(JSON.parse(JSON.stringify(saved.nav)));
    for (const c of closers.splice(0)) c();

    dir = await mkdtemp(join(tmpdir(), 'nav2-'));
    const b = await boot();
    expect(b.settings.get().nav).toEqual(DEFAULT_NAV);
    const res = await restore(b, bundle);
    expect(res.status).toBe(200);
    expect(b.settings.get().nav).toEqual(saved.nav);
    expect(b.settings.get().launcher).toEqual(saved.launcher);
    expect(b.settings.get().panel).toEqual(saved.panel);
  });

  it('a backup made before this feature leaves the rail, launcher and panel the person has arranged since, and restores the rest', async () => {
    const a = await boot({ settings: { theme: 'ember' } });
    const bundle = await backupOf(a);
    delete bundle.data.settings.nav;
    delete bundle.data.settings.launcher;
    delete bundle.data.settings.panel;
    for (const c of closers.splice(0)) c();

    dir = await mkdtemp(join(tmpdir(), 'nav3-'));
    const b = await boot({ settings: { nav: { ...DEFAULT_NAV, position: 'right', size: 'large' }, launcher: { version: 1, hidden: ['gps'] } } });
    const mineNav = b.settings.get().nav;
    const live = await connect(b);
    const res = await restore(b, bundle);
    expect(res.status).toBe(200);
    expect(b.settings.get().theme).toBe('ember');
    expect(b.settings.get().nav).toEqual(mineNav);
    expect(b.settings.get().nav.position).toBe('right');
    expect(b.settings.get().launcher.hidden).toEqual(['gps']);
    expect(b.settings.get().panel).toEqual(DEFAULT_PANEL); // this one had never been arranged
    // the screens that are open are told the restored settings, with the arrangements they already had
    await vi.waitFor(() => expect(live.settingsMessages().at(-1)?.theme).toBe('ember'));
    expect(live.settingsMessages().at(-1)?.nav).toEqual(mineNav);
  });

  it('a backup that carries them replaces them (a damaged one becomes the default, as on any load)', async () => {
    const a = await boot({ settings: { theme: 'ember' } });
    const bundle = await backupOf(a);
    bundle.data.settings.launcher = 'junk';
    for (const c of closers.splice(0)) c();

    dir = await mkdtemp(join(tmpdir(), 'nav4-'));
    const b = await boot({ settings: { launcher: { version: 1, hidden: ['gps'] } } });
    const res = await restore(b, bundle);
    expect(res.status).toBe(200);
    expect(b.settings.get().launcher).toEqual(DEFAULT_LAUNCHER);
  });
});
