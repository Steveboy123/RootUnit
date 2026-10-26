import { request } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, SERVICE_NAMES, type Settings } from '@headunit/shared';
import { config } from '../config';
import { GpsCenter } from '../gpsCenter';
import { demoForecast } from '../demo/net';
import { createMusic } from '../connections/music';
import { createSimDevices } from '../demo/devicesSim';
import { createMockMedia } from '../demo/mediaMock';
import { createMockProjection } from '../demo/projection';
import { createSimSystem } from '../demo/system';
import { createVehicleSim } from '../demo/vehicleSim';
import { Observable } from '../observable';
import { createCamera } from '../providers/camera';
import { createRadio } from '../radio/radio';
import { createApp } from '../server';
import { JsonStore } from '../store';

let dir: string;
let closers: Array<() => void> = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'feat-'))));
afterEach(async () => {
  for (const c of closers) c();
  closers = [];
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true });
});

const EVIL = { Origin: 'https://evil.example.com' };
const SECRET = 'SUPER-SECRET-REFRESH-TOKEN';

async function boot(opts: { fetch?: typeof fetch; settings?: Partial<Settings>; downloads?: boolean; gps?: (store: JsonStore) => GpsCenter } = {}) {
  const store = new JsonStore(dir);
  // Credentials that must never appear in a backup.
  await store.write('credentials.json', { spotify: { clientId: 'abc', refreshToken: SECRET } });
  await store.write('spotify.json', { accessToken: SECRET });
  await store.flush();
  const settings = new Observable<Settings>({ ...DEFAULT_SETTINGS, ...opts.settings });
  const layout = new Observable(DEFAULT_LAYOUT);
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
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.gps ? { gps: opts.gps(store) } : {}),
  });
  await app.features.start();
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  closers.push(() => app.close());
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  return {
    app,
    settings,
    layout,
    port,
    base,
    get: (p: string, headers?: Record<string, string>) => send('GET', p, undefined, headers),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    put: (p: string, b: unknown, h?: Record<string, string>) => send('PUT', p, b, h),
    del: (p: string, h?: Record<string, string>) => send('DELETE', p, undefined, h),
    rawStatus: (p: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        r.on('error', reject);
        r.end();
      }),
  };
}

describe('protection: the new routes sit behind the same Host and Origin checks as every other', () => {
  it('refuses a foreign Origin on every method that changes something', async () => {
    const s = await boot();
    for (const [method, path, body] of [
      ['POST', '/api/garage/fuel', { date: '2024-06-01', odometerKm: 1, liters: 1 }],
      ['PUT', '/api/garage/vehicle', { name: 'x' }],
      ['DELETE', '/api/trips?confirm=1', undefined],
      ['POST', '/api/timers', { seconds: 60 }],
      ['PUT', '/api/actions/config', { items: [] }],
      ['POST', '/api/backup/restore', { bundle: {} }],
      ['PUT', '/api/doc/perf', {}],
    ] as const) {
      const r = await (method === 'POST' ? s.post(path, body, EVIL) : method === 'PUT' ? s.put(path, body, EVIL) : s.del(path, EVIL));
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses a foreign Host (DNS rebinding) even for reads', async () => {
    const s = await boot();
    expect(await s.rawStatus('/api/garage', 'evil.example.com')).toBe(403);
    expect(await s.rawStatus('/api/backup', 'evil.example.com')).toBe(403);
    expect(await s.rawStatus('/api/garage', 'localhost')).toBe(200);
  });
});

describe('garage routes', () => {
  it('adds a fill-up, sets the odometer, and the new state is what the next read returns', async () => {
    const s = await boot();
    const r = await s.post('/api/garage/fuel', { date: '2024-06-01', odometerKm: 12_000, liters: 40.5, cost: 70, full: true });
    expect(r.status).toBe(200);
    const g = await (await s.get('/api/garage')).json();
    expect(g.vehicle.odometerKm).toBe(12_000);
    expect(g.fuel).toHaveLength(1);
    const id = g.fuel[0].id;
    expect((await s.del(`/api/garage/fuel/${id}`)).status).toBe(200);
    expect((await (await s.get('/api/garage')).json()).fuel).toEqual([]);
  });

  it('says what is wrong in plain words, with a 400', async () => {
    const s = await boot();
    const r = await s.post('/api/garage/fuel', { date: 'tomorrow', odometerKm: 1, liters: 1 });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('date');
    expect((await s.post('/api/garage/services', { name: 'Oil' })).status).toBe(400);
  });

  it('refuses ids that are not ours rather than looking them up', async () => {
    const s = await boot();
    expect((await s.del('/api/garage/fuel/..%2f..%2fetc')).status).toBe(404);
    expect((await s.put('/api/garage/fuel/ABC', { date: '2024-06-01', odometerKm: 1, liters: 1 })).status).toBe(404);
  });
});

describe('body limits', () => {
  it('a normal route stops at 8 KB; notes may be larger, but not without limit', async () => {
    const s = await boot();
    const big = (n: number) => ({ title: 'T', text: 'x'.repeat(n) });
    expect((await s.post('/api/garage/vehicle'.replace('vehicle', 'fuel'), { note: 'x'.repeat(9000) })).status).toBe(413);
    expect((await s.post('/api/notes', big(3900))).status).toBe(200); // over the 8 KB default once wrapped in JSON? it is under, still fine
    const wide = await s.post('/api/notes', { title: 'T', kind: 'list', items: Array.from({ length: 100 }, (_, i) => ({ text: `item ${i} `.padEnd(150, 'x') })) });
    expect(wide.status).toBe(200); // about 16 KB: allowed for notes
    expect((await s.post('/api/notes', { title: 'T', text: 'y'.repeat(70_000) })).status).toBe(413);
  });
});

describe('timers, scenes and notes', () => {
  it('a timer can be set and cancelled', async () => {
    const s = await boot();
    const t = await (await s.post('/api/timers', { seconds: 600, kind: 'parking', label: 'Meter' })).json();
    expect(t).toMatchObject({ label: 'Meter', kind: 'parking' });
    expect(s.app.features.services.timers.get().items).toHaveLength(1);
    expect((await s.del(`/api/timers/${t.id}`)).status).toBe(200);
    expect((await s.post('/api/timers', { seconds: 1 })).status).toBe(400);
  });

  it('a first run has the default scenes, and they can be changed', async () => {
    const s = await boot();
    const list = await (await s.get('/api/scenes')).json();
    expect(list.map((x: { name: string }) => x.name)).toContain('Night drive');
    const created = await (await s.post('/api/scenes', { name: 'Camping', icon: 'mountain', actions: { brightness: 20 } })).json();
    expect((await s.put(`/api/scenes/${created.id}`, { name: 'Camping 2', actions: {} })).status).toBe(200);
    expect((await s.del(`/api/scenes/${created.id}`)).status).toBe(200);
    expect((await s.del(`/api/scenes/${created.id}`)).status).toBe(404);
    expect((await s.post('/api/scenes', { name: '' })).status).toBe(400);
  });

  it('notes: create, tick an item, list, delete', async () => {
    const s = await boot();
    const note = await (await s.post('/api/notes', { title: 'Trip', kind: 'list', items: [{ text: 'Passport' }] })).json();
    const done = await (await s.put(`/api/notes/${note.id}`, { ...note, items: note.items.map((i: object) => ({ ...i, done: true })) })).json();
    expect(done.items[0].done).toBe(true);
    expect((await (await s.get('/api/notes')).json())).toHaveLength(1);
    expect((await s.del(`/api/notes/${note.id}`)).status).toBe(200);
    expect((await s.del(`/api/notes/${note.id}`)).status).toBe(404);
  });
});

describe('quick actions', () => {
  it('the screens are told the name and icon, never the address; the editor gets the address; an internet address is refused', async () => {
    const s = await boot();
    const put = await s.put('/api/actions/config', { items: [{ name: 'Garage', icon: 'door', url: 'http://192.168.1.50/hook/TOPSECRET' }, { name: 'Cloud', url: 'https://93.184.216.34/x' }] });
    expect(put.status).toBe(200);
    const pub = JSON.stringify(s.app.features.services.actions.get());
    expect(pub).toContain('Garage');
    expect(pub).not.toContain('TOPSECRET');
    const cfg = await (await s.get('/api/actions/config')).json();
    expect(cfg.items[0].url).toContain('TOPSECRET');
    const cloud = cfg.items[1].id;
    const r = await s.post(`/api/actions/${cloud}/run`);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain('internet');
  });

  it('runs an action against the car network and reports only the status', async () => {
    const f = vi.fn(async () => new Response('private body', { status: 200 }));
    const s = await boot({ fetch: f as unknown as typeof fetch });
    await s.put('/api/actions/config', { items: [{ name: 'Light', url: 'http://127.0.0.1:9/on' }] });
    const id = (await (await s.get('/api/actions/config')).json()).items[0].id;
    const r = await (await s.post(`/api/actions/${id}/run`)).json();
    expect(r).toEqual({ ok: true, status: 200, message: 'Done' });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('lyrics', () => {
  it('stay off, and nothing leaves the Pi, until the owner switches them on', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ plainLyrics: 'la', syncedLyrics: '[00:01.00]la' }), { status: 200 }));
    const s = await boot({ fetch: f as unknown as typeof fetch });
    const off = await s.get('/api/lyrics?title=Song&artist=Band');
    expect(off.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
    s.settings.update({ lyrics: true });
    const on = await s.get('/api/lyrics?title=Song&artist=Band&duration=200');
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ synced: [{ t: 1000, text: 'la' }], plain: 'la' });
    expect((await s.get('/api/lyrics?title=Song')).status).toBe(400);
  });
});

describe('documents', () => {
  it('keeps best times for the screen, only under known names', async () => {
    const s = await boot();
    expect(await (await s.get('/api/doc/perf')).json()).toEqual({});
    expect((await s.put('/api/doc/perf', { best0100: 8.4 })).status).toBe(200);
    expect(await (await s.get('/api/doc/perf')).json()).toEqual({ best0100: 8.4 });
    expect((await s.get('/api/doc/settings')).status).toBe(404);
    expect((await s.put('/api/doc/credentials', {})).status).toBe(404);
    expect((await s.put('/api/doc/arcade', { x: 'y'.repeat(20_000) })).status).toBe(413);
  });
});

describe('backup and restore', () => {
  it('contains what the owner made and none of the secrets', async () => {
    const s = await boot();
    await s.post('/api/garage/fuel', { date: '2024-06-01', odometerKm: 5000, liters: 30 });
    await s.put('/api/actions/config', { items: [{ name: 'Garage', url: 'http://192.168.1.50/hook/ACTIONSECRET' }] });
    const r = await s.get('/api/backup');
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename=headunit-backup-\d{8}-\d{4}\.json/);
    const text = await r.text();
    const bundle = JSON.parse(text);
    expect(bundle).toMatchObject({ app: 'rpi-head-unit', version: 2 });
    expect(Object.keys(bundle.data).sort()).toEqual(['garage', 'layout', 'notes', 'radio', 'scenes', 'settings', 'trips']);
    expect(bundle.data.garage.fuel).toHaveLength(1);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('ACTIONSECRET');
    expect(text).not.toContain('refreshToken');
  });

  it('puts everything back from an uploaded backup, validating each part', async () => {
    const a = await boot();
    await a.post('/api/garage/fuel', { date: '2024-06-01', odometerKm: 5000, liters: 30 });
    await a.post('/api/notes', { title: 'Packing', kind: 'list', items: [{ text: 'Tent' }] });
    a.settings.update({ accent: '#ff0000', units: 'imperial' });
    const bundle = await (await a.get('/api/backup')).json();
    for (const c of closers.splice(0)) c();

    dir = await mkdtemp(join(tmpdir(), 'feat2-'));
    const b = await boot();
    expect(b.settings.get().units).toBe('metric');
    const r = await b.post('/api/backup/restore', { bundle });
    expect(r.status).toBe(200);
    const report = await r.json();
    expect(report.restored).toEqual(['settings', 'layout', 'garage', 'trips', 'notes', 'scenes', 'radio']);
    expect(report.skipped).toEqual([]);
    expect(b.settings.get()).toMatchObject({ accent: '#ff0000', units: 'imperial' });
    expect((await (await b.get('/api/garage')).json()).fuel).toHaveLength(1);
    expect((await (await b.get('/api/notes')).json())[0].title).toBe('Packing');
  });

  it('restores a damaged part as skipped, not as an error for the whole file', async () => {
    const s = await boot();
    const bundle = { app: 'rpi-head-unit', version: 2, createdAt: 'x', data: { settings: { units: 'imperial', accent: 'javascript:alert(1)' }, layout: { version: 99 }, garage: { fuel: 'nonsense' } } };
    const report = await (await s.post('/api/backup/restore', { bundle })).json();
    expect(report.restored).toEqual(['settings', 'garage']);
    expect(report.skipped).toEqual([{ part: 'layout', reason: 'The dashboard layout in the backup is damaged.' }]);
    expect(s.settings.get().units).toBe('imperial');
    expect(s.settings.get().accent).toBe(DEFAULT_SETTINGS.accent); // an invalid colour never gets in
  });

  it('refuses a file that is not a backup, or one from a newer version', async () => {
    const s = await boot();
    const a = await s.post('/api/backup/restore', { bundle: { hello: 'world' } });
    expect(a.status).toBe(400);
    expect((await a.json()).error).toContain('not a head unit backup');
    const b = await s.post('/api/backup/restore', { bundle: { app: 'rpi-head-unit', version: 99, data: {} } });
    expect((await b.json()).error).toContain('newer version');
  });

  it('finds a downloaded backup and restores it by name, and reads nothing else from that folder', async () => {
    const s = await boot();
    const bundle = await (await s.get('/api/backup')).json();
    await mkdir(join(dir, 'Downloads'), { recursive: true });
    await writeFile(join(dir, 'Downloads', 'headunit-backup-20240601-1200.json'), JSON.stringify(bundle));
    await writeFile(join(dir, 'Downloads', 'notes.txt'), 'private');
    await writeFile(join(dir, 'Downloads', 'headunit-backup-evil.json'), '{}');
    const list = await (await s.get('/api/backup/available')).json();
    expect(list.map((x: { file: string }) => x.file)).toEqual(['headunit-backup-20240601-1200.json']);
    expect((await s.post('/api/backup/restore', { file: 'headunit-backup-20240601-1200.json' })).status).toBe(200);
    for (const bad of ['../../etc/passwd', 'notes.txt', 'headunit-backup-evil.json', '/etc/passwd', 'headunit-backup-20240601-1200.json/../../x']) {
      const r = await s.post('/api/backup/restore', { file: bad });
      expect(r.status, bad).toBe(400);
    }
    expect((await s.post('/api/backup/restore', { file: 'headunit-backup-20991231-2359.json' })).status).toBe(404);
  });
});

describe('the services channel', () => {
  it('sends every service in the snapshot and then pushes changes as they happen', async () => {
    const s = await boot();
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: s.base } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await vi.waitFor(() => expect(messages.some((m) => m.t === 'snapshot')).toBe(true));
    const snap = messages.find((m) => m.t === 'snapshot')!;
    expect(Object.keys(snap.svc as object).sort()).toEqual([...SERVICE_NAMES].sort());
    expect((snap.svc as { scenes: unknown[] }).scenes.length).toBeGreaterThan(0);

    await s.post('/api/timers', { seconds: 300, label: 'Pasta' });
    await vi.waitFor(() => expect(messages.some((m) => m.t === 'svc' && m.name === 'timers' && JSON.stringify(m.data).includes('Pasta'))).toBe(true));
    ws.close();
  });
});

describe('weather follows the first GPS fix', () => {
  it('asks for the forecast when the satellites are found, not at the next minute’s tick', async () => {
    const calls: string[] = [];
    const f = (async (u: unknown) => {
      calls.push(String(u));
      return new Response(JSON.stringify(demoForecast(Date.now())), { status: 200 });
    }) as typeof fetch;
    let gps!: GpsCenter;
    const s = await boot({ fetch: f, gps: (store) => (gps = new GpsCenter(store)) });
    expect(calls).toHaveLength(0); // nowhere to ask about yet
    expect((await (await s.get('/api/weather')).json()).status).toBe('no-location');

    gps.ingest({ class: 'TPV', mode: 3, lat: 51.5, lon: -0.12, speed: 0, track: 0, eph: 5 });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain('latitude=51.5');
    // Rounded to about a kilometre before leaving the Pi: the second decimal at most.
    expect(calls[0]).toMatch(/longitude=-0\.12(?:&|$)/);
    await vi.waitFor(async () => expect((await (await s.get('/api/weather')).json()).status).toBe('ok'));

    // More fixes while the sky stays visible do not ask again.
    gps.ingest({ class: 'TPV', mode: 3, lat: 51.5001, lon: -0.1201, speed: 10, track: 0, eph: 5 });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);
  });
});

describe('GPS routes', () => {
  it('answers the state itself, not the object that holds it', async () => {
    const s = await boot();
    const state = await (await s.get('/api/gps/state')).json();
    expect(state).toMatchObject({ connected: false, fix: false, tripKm: 0 });
    expect(state).not.toHaveProperty('value');
    expect(state).not.toHaveProperty('listeners');
  });
  it('serves the breadcrumb as a plain list', async () => {
    const s = await boot();
    expect(await (await s.get('/api/gps/track.json')).json()).toEqual([]);
  });
});
