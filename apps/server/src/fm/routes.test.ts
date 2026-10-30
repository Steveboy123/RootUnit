import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FM_MAX_PRESETS, FM_NOTICE_VERSION, type FmState } from '@headunit/shared';
import { BodyTooLarge } from '../http';
import type { FmBackend, FmObserved, FmWanted } from './backend';
import { FM_NO_CONFIG, readFmConfig } from './config';
import { createFmRoutes } from './routes';
import { FmService } from './service';
import { MemStore, TOKEN } from './testing/fakes';

/** An engine that shows what the test says and records how often it was nudged. */
class StubBackend implements FmBackend {
  wanted: () => FmWanted = () => ({ on: false, frequency: 88.1, tunedAt: 0 });
  report: (o: FmObserved) => void = () => undefined;
  pokes = 0;
  wantedSeen: FmWanted[] = [];
  start(wanted: () => FmWanted, report: (o: FmObserved) => void): void {
    this.wanted = wanted;
    this.report = report;
    this.show({});
  }
  poke(): void {
    this.pokes++;
    this.wantedSeen.push(this.wanted());
  }
  async stop(): Promise<void> {}
  show(o: Partial<FmObserved>): void {
    this.report({ mode: 'remote', status: 'idle', detail: 'Ready.', board: null, limits: { min: 87.5, max: 108 }, level: 0, ...o });
  }
}

let server: Server;
let base: string;
let service: FmService;
let backend: StubBackend;
let store: MemStore;

async function boot(file?: unknown) {
  store = new MemStore();
  if (file !== undefined) store.files.set('fm.json', file);
  backend = new StubBackend();
  service = new FmService({ store: store.asStore(), config: readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:8788' }), backend });
  await service.start();
  const handle = createFmRoutes(service);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (await handle(req, res, req.method ?? 'GET', url.pathname)) return;
      res.writeHead(404).end('{"error":"not found"}');
    } catch (e) {
      // what the real server does
      res.writeHead(e instanceof BodyTooLarge ? 413 : 500).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => boot());
afterEach(async () => {
  await service.stop();
  await new Promise((r) => server.close(r));
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const accepted = { version: 1, frequency: 100.6, on: false, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } };

describe('GET /api/fm/status', () => {
  it('is the state the screens follow, as JSON', async () => {
    const r = await fetch(`${base}/api/fm/status`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual(service.state.get());
  });

  it('follows the state as it changes, and has no password and no address in it', async () => {
    backend.show({ status: 'unreachable', detail: 'The FM helper on the second Pi does not answer.' });
    const text = await (await fetch(`${base}/api/fm/status`)).text();
    expect(JSON.parse(text)).toMatchObject({ status: 'unreachable' });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('192.168');
  });

  it('is not an answer to other methods or other paths', async () => {
    for (const [method, path] of [['POST', '/api/fm/status'], ['GET', '/api/fm/tune'], ['GET', '/api/fm/power'], ['PUT', '/api/fm/tune'], ['DELETE', '/api/fm/preset'], ['GET', '/api/fm/'], ['GET', '/api/fm/other'], ['GET', '/api/fm']] as const) {
      const r = await fetch(base + path, { method });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('POST /api/fm/tune', () => {
  it('sets the frequency, rounded, and answers with the new state', async () => {
    const r = await post('/api/fm/tune', { frequency: 99.96 });
    expect(r.status).toBe(200);
    expect((await r.json()).frequency).toBe(100);
    expect(service.state.get().frequency).toBe(100);
    expect(store.files.get('fm.json')).toMatchObject({ frequency: 100 });
  });

  it('wakes the engine so that the change is made now', async () => {
    const before = backend.pokes;
    await post('/api/fm/tune', { frequency: 95.5 });
    expect(backend.pokes).toBe(before + 1);
    expect(backend.wantedSeen.at(-1)).toMatchObject({ on: false, frequency: 95.5 });
  });

  it('says what is wrong, with a 400, for anything that is not a number in the band', async () => {
    for (const body of [{ frequency: '100.6' }, { frequency: null }, { frequency: true }, { frequency: [100.6] }, { frequency: {} }, { frequency: 87.4 }, { frequency: 108.1 }, { frequency: -100 }, { frequency: 1e308 }, {}, { freq: 100 }, '{broken', '', 'null', '[]', '"100.6"', '100.6', '[100.6]']) {
      const r = await post('/api/fm/tune', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await r.json()).error, JSON.stringify(body)).toMatch(/between 87\.5 and 108\.0 MHz/);
    }
    expect(service.state.get().frequency).toBe(88.1);
  });

  it('numbers that JSON cannot carry are refused too', async () => {
    for (const body of ['{"frequency": NaN}', '{"frequency": Infinity}', '{"frequency": 1e999}']) expect((await post('/api/fm/tune', body)).status, body).toBe(400);
  });

  it('ignores fields it does not know', async () => {
    const r = await post('/api/fm/tune', { frequency: 90, on: true, token: 'x', extra: { deep: 1 } });
    expect(r.status).toBe(200);
    const s: FmState = await r.json();
    expect(s).toMatchObject({ frequency: 90, on: false });
  });

  it('a body over 1 KB is refused before it is read in full', async () => {
    const r = await post('/api/fm/tune', { frequency: 90, pad: 'x'.repeat(2000) });
    expect(r.status).toBe(413);
    expect(service.state.get().frequency).toBe(88.1);
    const huge = await post('/api/fm/tune', { frequency: 90, pad: 'x'.repeat(5_000_000) }).catch(() => ({ status: 413 }));
    expect(huge.status).toBe(413);
  });
});

describe('POST /api/fm/power', () => {
  it('on before the notice is accepted: 403, and nothing is asked of the engine', async () => {
    const before = backend.pokes;
    const r = await post('/api/fm/power', { on: true });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/notice/);
    expect(service.state.get().on).toBe(false);
    expect(backend.pokes).toBe(before);
    expect(backend.wantedSeen.every((w) => !w.on)).toBe(true);
  });

  it('on after the notice is accepted: the engine is asked to put it on the air', async () => {
    await post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    const r = await post('/api/fm/power', { on: true });
    expect(r.status).toBe(200);
    expect((await r.json()).on).toBe(true);
    expect(backend.wantedSeen.at(-1)).toMatchObject({ on: true, frequency: 88.1 });
    expect(store.files.get('fm.json')).toMatchObject({ on: true });
    const off = await post('/api/fm/power', { on: false });
    expect(off.status).toBe(200);
    expect(backend.wantedSeen.at(-1)).toMatchObject({ on: false, frequency: 88.1 });
  });

  it('409 with the reason when there is nothing to switch on: not set up, or a board that cannot', async () => {
    await post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    backend.show({ status: 'unconfigured', mode: 'none', detail: 'The FM transmitter is not set up. See docs/fm.md.' });
    let r = await post('/api/fm/power', { on: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('The FM transmitter is not set up. See docs/fm.md.');
    backend.show({ status: 'unsupported', detail: 'This is a Raspberry Pi 5.' });
    r = await post('/api/fm/power', { on: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('This is a Raspberry Pi 5.');
    expect(service.state.get().on).toBe(false);
  });

  it('off is always allowed, also when it cannot be switched on', async () => {
    backend.show({ status: 'unsupported', detail: 'No.' });
    expect((await post('/api/fm/power', { on: false })).status).toBe(200);
  });

  it('403 comes before 409 (the notice is the first thing asked)', async () => {
    backend.show({ status: 'unsupported', detail: 'No.' });
    expect((await post('/api/fm/power', { on: true })).status).toBe(403);
  });

  it('unreachable or still starting can be switched on: it keeps trying', async () => {
    await post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    for (const status of ['unreachable', 'error', 'starting', 'idle', 'transmitting'] as const) {
      backend.show({ status });
      expect((await post('/api/fm/power', { on: true })).status, status).toBe(200);
    }
  });

  it('on must be a real true or false', async () => {
    await post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    for (const body of [{ on: 'true' }, { on: 1 }, { on: 0 }, { on: null }, { on: [] }, {}, '{', '[]', 'true', '1']) {
      const r = await post('/api/fm/power', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(service.state.get().on).toBe(false);
  });
});

describe('POST /api/fm/acknowledge', () => {
  it('accepts the version of the notice that is current, and only that', async () => {
    for (const body of [{ version: 0 }, { version: 2 }, { version: '1' }, { version: null }, { version: true }, {}, 'x', '[1]']) {
      const r = await post('/api/fm/acknowledge', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(service.state.get().acknowledged).toBe(false);
    const ok = await post('/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    expect(ok.status).toBe(200);
    expect((await ok.json()).acknowledged).toBe(true);
    expect(store.files.get('fm.json')).toMatchObject({ ack: { version: FM_NOTICE_VERSION } });
  });
});

describe('POST /api/fm/preset', () => {
  it('saves, removes, and is quiet about a repeat', async () => {
    let s: FmState = await (await post('/api/fm/preset', { frequency: 99.9, saved: true })).json();
    expect(s.presets).toEqual([99.9]);
    s = await (await post('/api/fm/preset', { frequency: 99.9, saved: true })).json();
    expect(s.presets).toEqual([99.9]);
    s = await (await post('/api/fm/preset', { frequency: 99.9, saved: false })).json();
    expect(s.presets).toEqual([]);
    s = await (await post('/api/fm/preset', { frequency: 99.9, saved: false })).json();
    expect(s.presets).toEqual([]);
  });

  it('400 for a bad frequency, a missing yes/no, or too many', async () => {
    for (const body of [{ frequency: 'x', saved: true }, { frequency: 200, saved: true }, { frequency: 99.9 }, { frequency: 99.9, saved: 'true' }, { saved: true }, {}, 'x']) {
      expect((await post('/api/fm/preset', body)).status, JSON.stringify(body)).toBe(400);
    }
    for (let i = 0; i < FM_MAX_PRESETS; i++) expect((await post('/api/fm/preset', { frequency: 90 + i, saved: true })).status).toBe(200);
    const r = await post('/api/fm/preset', { frequency: 100, saved: true });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/up to 6/);
    expect(service.state.get().presets).toHaveLength(FM_MAX_PRESETS);
  });
});

describe('the routes never leak', () => {
  it('no answer, error or not, holds the password', async () => {
    const texts: string[] = [];
    for (const [path, body] of [['/api/fm/tune', { frequency: 1 }], ['/api/fm/power', { on: true }], ['/api/fm/acknowledge', { version: 9 }], ['/api/fm/preset', { frequency: 1, saved: true }], ['/api/fm/tune', { frequency: TOKEN }]] as const) {
      texts.push(await (await post(path, body)).text());
    }
    texts.push(await (await fetch(`${base}/api/fm/status`)).text());
    for (const t of texts) expect(t).not.toContain(TOKEN);
  });

  it('a service that is not set up answers too', async () => {
    const s = new FmService({ store: new MemStore().asStore(), config: FM_NO_CONFIG });
    await s.start();
    expect(s.state.get().status).toBe('unconfigured');
    await s.stop();
  });
});
