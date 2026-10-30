import { request } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, FM_NOTICE_VERSION, type FmState, type Settings } from '@headunit/shared';
import { config } from '../config';
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
import { readFmConfig } from './config';
import { BASE_URL, FakeHelper, FakeNet, TOKEN, captureConsole, until } from './testing/fakes';

let dir: string;
let closers: Array<() => void | Promise<void>> = [];
let quiet: ReturnType<typeof captureConsole>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fm-app-'));
  quiet = captureConsole();
});
afterEach(async () => {
  for (const c of closers.reverse()) await c();
  closers = [];
  quiet.restore();
  await new Promise((r) => setTimeout(r, 20));
  await rm(dir, { recursive: true, force: true });
});

const EVIL = { Origin: 'https://evil.example.com' };

interface BootOptions {
  /** A helper is set up (the password in the environment, the address of a fake helper). */
  configured?: boolean;
  demo?: boolean;
  file?: unknown;
  /** How the fake helper behaves from the very first request. */
  helperMode?: FakeHelper['mode'];
}

async function boot(opts: BootOptions = {}) {
  const store = new JsonStore(dir);
  if (opts.file !== undefined) {
    await store.write('fm.json', opts.file);
    await store.flush();
  }
  const helper = new FakeHelper();
  if (opts.helperMode) helper.mode = opts.helperMode;
  const net = new FakeNet();
  net.auto = 'ok';
  net.onAccepted = () => (helper.node.audio = { connected: true, level: 0.3, underruns: 0 });
  const settings = new Observable<Settings>({ ...DEFAULT_SETTINGS });
  const music = createMusic({ store, settings, config });
  closers.push(() => music.dispose());
  const app = createApp({
    config: {
      ...config,
      dataDir: dir,
      updater: { ...config.updater, downloadDir: join(dir, 'Downloads') },
      fm: opts.configured ? readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: BASE_URL }) : readFmConfig({}),
    },
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
    layout: new Observable(DEFAULT_LAYOUT),
    demo: opts.demo ?? false,
    fm: { fetch: helper.fetch as unknown as typeof fetch, spawn: net.spawn, connect: net.connect },
  });
  await app.features.start();
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    app.close();
  };
  closers.push(close);
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  return {
    app,
    helper,
    net,
    store,
    port,
    base,
    close,
    get: (p: string, h?: Record<string, string>) => send('GET', p, undefined, h),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
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

describe('in the real server', () => {
  it('/api/fm/status is the real state, not the old stub that always said "unavailable"', async () => {
    const s = await boot();
    const body = await (await s.get('/api/fm/status')).json();
    expect(body).toMatchObject({ mode: 'none', status: 'unconfigured', on: false, acknowledged: false, demo: false });
    expect(body).not.toHaveProperty('supported');
    expect(body).not.toHaveProperty('hardware');
    expect(body).toEqual(s.app.features.services.fm.get());
  });

  it('the routes sit behind the same Host and Origin checks as every other', async () => {
    const s = await boot({ demo: true });
    for (const [path, body] of [['/api/fm/tune', { frequency: 90 }], ['/api/fm/power', { on: false }], ['/api/fm/acknowledge', { version: FM_NOTICE_VERSION }], ['/api/fm/preset', { frequency: 90, saved: true }]] as const) {
      const r = await s.post(path, body, EVIL);
      expect(r.status, path).toBe(403);
    }
    expect(s.app.features.services.fm.get()).toMatchObject({ frequency: 88.1, acknowledged: false, presets: [] });
    expect(await s.rawStatus('/api/fm/status', 'evil.example.com')).toBe(403);
    expect(await s.rawStatus('/api/fm/status', 'localhost')).toBe(200);
  });

  it('a request over 1 KB is refused with 413', async () => {
    const s = await boot({ demo: true });
    expect((await s.post('/api/fm/tune', { frequency: 90, pad: 'x'.repeat(2000) })).status).toBe(413);
    expect((await s.post('/api/fm/tune', { frequency: 90 })).status).toBe(200);
  });

  it('is in the snapshot a screen gets, and every change is pushed to it', async () => {
    const s = await boot({ demo: true });
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: s.base } });
    closers.push(() => ws.terminate());
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    await until(() => expect(messages.some((m) => m.t === 'snapshot')).toBe(true));
    const snap = messages.find((m) => m.t === 'snapshot')!;
    expect((snap.svc as { fm: FmState }).fm).toMatchObject({ demo: true, status: 'idle', mode: 'local' });

    await s.post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    await s.post('/api/fm/power', { on: true });
    await until(() => expect(messages.some((m) => m.t === 'svc' && m.name === 'fm' && (m.data as FmState).status === 'transmitting')).toBe(true));
    ws.close();
  });

  it('the notice first: on is refused until it is accepted, over HTTP too', async () => {
    const s = await boot({ demo: true });
    expect((await s.post('/api/fm/power', { on: true })).status).toBe(403);
    expect((await s.post('/api/fm/acknowledge', { version: 99 })).status).toBe(400);
    expect((await s.post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION })).status).toBe(200);
    const on = await (await s.post('/api/fm/power', { on: true })).json();
    expect(on).toMatchObject({ on: true, status: 'transmitting', demo: true });
  });

  it('what is saved lives in data/fm.json only, and is back after the server restarts', async () => {
    const s = await boot({ demo: true });
    await s.post('/api/fm/tune', { frequency: 93.7 });
    await s.post('/api/fm/preset', { frequency: 93.7, saved: true });
    await s.store.flush();
    const saved = JSON.parse(await readFile(join(dir, 'fm.json'), 'utf8'));
    expect(saved).toMatchObject({ version: 1, frequency: 93.7, presets: [93.7], on: false });
    s.close();
    const again = await boot({ demo: true, file: saved });
    expect(await (await again.get('/api/fm/status')).json()).toMatchObject({ frequency: 93.7, presets: [93.7] });
  });
});

describe('the password in the real server', () => {
  it('appears in no answer, no state, no backup, no saved file', async () => {
    const s = await boot({ configured: true, file: { version: 1, frequency: 100.6, on: true, presets: [90], ack: { version: FM_NOTICE_VERSION, at: 1 } } });
    await until(() => expect(s.app.features.services.fm.get().status).toBe('transmitting'));
    await s.post('/api/fm/tune', { frequency: 95.5 });
    await until(() => expect(s.helper.node.frequency).toBe(95.5));
    const answers = [await (await s.get('/api/fm/status')).text(), await (await s.get('/api/backup')).text(), await (await s.get('/api/fm/status')).text(), JSON.stringify(s.app.features.services.fm.get())];
    for (const text of answers) expect(text).not.toContain(TOKEN);
    // nor the address, which belongs in .env alone
    expect(answers[0]).not.toContain('192.168');
    await s.store.flush();
    for (const name of await readdir(dir)) {
      if (!/\.json(\.bak)?$/.test(name)) continue;
      expect(await readFile(join(dir, name), 'utf8'), name).not.toContain(TOKEN);
    }
    expect(quiet.lines.join('\n')).not.toContain(TOKEN);
  });

  it('is not in a backup, and a backup does not carry the FM settings (they belong to this hardware)', async () => {
    const s = await boot({ configured: true, file: { version: 1, frequency: 100.6, on: false, presets: [90], ack: { version: FM_NOTICE_VERSION, at: 1 } } });
    const bundle = await (await s.get('/api/backup')).json();
    expect(Object.keys(bundle.data)).not.toContain('fm');
    expect(JSON.stringify(bundle)).not.toMatch(/fm_|"fm"|FM_NODE/);
  });
});

describe('shutdown', () => {
  it('closing the server switches the carrier off and leaves no sound process or connection', async () => {
    const s = await boot({ configured: true, file: { version: 1, frequency: 100.6, on: true, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } } });
    await until(() => expect(s.app.features.services.fm.get().status).toBe('transmitting'));
    expect(s.helper.node.state).toBe('transmitting');
    s.close();
    await until(() => expect(s.helper.to('POST', '/v1/stop')).toHaveLength(1));
    expect(s.helper.node.state).toBe('idle');
    await until(() => expect(s.net.leftBehind).toBe(0));
    // and nothing asks the helper again
    const calls = s.helper.calls.length;
    await new Promise((r) => setTimeout(r, 2500));
    expect(s.helper.calls.length).toBe(calls);
  });

  it('closing a server that never used FM does not talk to anything', async () => {
    const s = await boot({ configured: true });
    await until(() => expect(s.helper.to('GET', '/v1/status').length).toBeGreaterThan(0));
    s.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(s.helper.to('POST', '/v1/stop')).toHaveLength(0);
    expect(s.net.children).toHaveLength(0);
  });

  it('a helper that does not answer does not hold up the start of the head unit, and closing cancels the question', async () => {
    const t0 = Date.now();
    const s = await boot({ configured: true, helperMode: 'hang' });
    expect(Date.now() - t0).toBeLessThan(2000); // features.start() did not wait the 3 seconds the helper is given
    await until(() => expect(s.helper.inFlight).toBe(1));
    expect(s.app.features.services.fm.get()).toMatchObject({ mode: 'remote', status: 'idle' });
    s.close();
    await until(() => expect(s.helper.inFlight).toBe(0));
    expect(s.helper.aborted).toBe(1);
  });
});
