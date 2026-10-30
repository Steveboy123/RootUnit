import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../store';
import { BUILTIN_STATIONS, createRadio, makeStation, type RadioProvider } from './radio';

let dir: string;
let store: JsonStore;
let servers: Server[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'radio-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  for (const s of servers) s.closeAllConnections?.(), s.close();
  servers = [];
  await store.flush(); // the provider saves fire-and-forget; let it finish before deleting the dir
  await rm(dir, { recursive: true, force: true });
});

const listen = (s: Server) =>
  new Promise<number>((r) => {
    servers.push(s);
    s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, what: string, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(10);
  }
  throw new Error(`timed out: ${what}`);
}

const block = (title: string) => {
  const t = Buffer.from(`StreamTitle='${title}';`);
  const n = Math.ceil(t.length / 16);
  return Buffer.concat([Buffer.from([n]), t, Buffer.alloc(n * 16 - t.length)]);
};

/** A pretend Icecast: 32-byte audio frames with a metadata block after every one. */
function fakeIcecast(opts: { status?: number; onClose?: () => void } = {}) {
  const AUDIO = Buffer.alloc(32, 0xab);
  const server = createServer((req: IncomingMessage, res) => {
    if (opts.status && opts.status !== 200) return void res.writeHead(opts.status).end();
    expect(req.headers['icy-metadata']).toBe('1');
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '32' });
    let n = 0;
    const t = setInterval(() => res.write(Buffer.concat([AUDIO, block(n++ === 0 ? 'First Song' : 'Second Song')])), 20);
    res.on('close', () => {
      clearInterval(t);
      opts.onClose?.();
    });
  });
  return { server, AUDIO };
}

/** Our own server wrapping radio.stream(), like the real app does. */
function relay(radio: RadioProvider) {
  return createServer((req, res) => {
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    void radio.stream(new URL(req.url!, 'http://x').pathname.slice(1), res, ac.signal);
  });
}

const mk = (over: Partial<Parameters<typeof createRadio>[0]> = {}) => createRadio({ store, ...over });

describe('station validation', () => {
  it('accepts http(s) only and trims names', () => {
    expect(makeStation({ name: '  Jazz  ', url: 'https://x.test/stream' })).toMatchObject({ name: 'Jazz', url: 'https://x.test/stream', kind: 'internet' });
    expect(makeStation({ name: 'x', url: 'ftp://x.test/a' })).toBeNull();
    expect(makeStation({ name: 'x', url: 'javascript:alert(1)' })).toBeNull();
    expect(makeStation({ name: 'x', url: 'file:///etc/passwd' })).toBeNull();
    expect(makeStation({ name: '', url: 'https://x.test' })).toBeNull();
    expect(makeStation({ name: 'x', url: 'not a url' })).toBeNull();
    expect(makeStation({ name: 1, url: 'https://x.test' })).toBeNull();
  });
  it('gives the same id to the same URL and ignores insecure logos', () => {
    expect(makeStation({ name: 'A', url: 'https://x.test/s' })!.id).toBe(makeStation({ name: 'B', url: 'https://x.test/s' })!.id);
    expect(makeStation({ name: 'A', url: 'https://x.test/s', logo: 'http://x.test/l.png' })!.logo).toBeUndefined();
    expect(makeStation({ name: 'A', url: 'https://x.test/s', logo: 'https://x.test/l.png' })!.logo).toBe('https://x.test/l.png');
  });
});

describe('radio provider', () => {
  it('plays, stops, steps through stations and wraps around', async () => {
    let started = 0;
    const r = mk({ onStart: () => void started++ });
    await r.command({ cmd: 'play' });
    expect(r.state.get()).toMatchObject({ playing: true, status: 'connecting', stationId: BUILTIN_STATIONS[0]!.id, session: 1 });
    expect(started).toBe(1);
    await r.command({ cmd: 'next' });
    expect(r.state.get().stationId).toBe(BUILTIN_STATIONS[1]!.id);
    await r.command({ cmd: 'prev' });
    await r.command({ cmd: 'prev' });
    expect(r.state.get().stationId).toBe(BUILTIN_STATIONS.at(-1)!.id);
    await r.command({ cmd: 'stop' });
    expect(r.state.get()).toMatchObject({ playing: false, status: 'idle' });
    await r.command({ cmd: 'toggle' });
    expect(r.state.get().playing).toBe(true);
    expect(r.state.get().session).toBeGreaterThan(3);
  });

  it('plays the first favourite when starting cold', async () => {
    const r = mk();
    await r.command({ cmd: 'favorite', id: BUILTIN_STATIONS[2]!.id, on: true });
    await r.command({ cmd: 'play' });
    expect(r.state.get().stationId).toBe(BUILTIN_STATIONS[2]!.id);
  });

  it('adds, dedupes and removes stations (built-ins stay removed)', async () => {
    const r = mk();
    const n = r.state.get().stations.length;
    await r.command({ cmd: 'add', name: 'Mine', url: 'https://mine.test/s' });
    await r.command({ cmd: 'add', name: 'Mine again', url: 'https://mine.test/s' });
    await r.command({ cmd: 'add', name: 'Bad', url: 'ftp://nope' });
    expect(r.state.get().stations).toHaveLength(n + 1);
    const id = r.state.get().stations.at(-1)!.id;
    await r.command({ cmd: 'favorite', id, on: true });
    await r.command({ cmd: 'play', id });
    await r.command({ cmd: 'remove', id });
    expect(r.state.get()).toMatchObject({ playing: false, stationId: null });
    expect(r.state.get().favorites).not.toContain(id);
    await r.command({ cmd: 'remove', id: BUILTIN_STATIONS[0]!.id });
    expect(r.state.get().stations.some((s) => s.id === BUILTIN_STATIONS[0]!.id)).toBe(false);
  });

  it('persists stations, favourites and the last station across restarts', async () => {
    const a = createRadio({ store });
    await a.command({ cmd: 'add', name: 'Mine', url: 'https://mine.test/s' });
    const mine = a.state.get().stations.at(-1)!.id;
    await a.command({ cmd: 'favorite', id: mine, on: true });
    await a.command({ cmd: 'remove', id: BUILTIN_STATIONS[1]!.id });
    await a.command({ cmd: 'play', id: mine });
    await store.write('flush', 1);

    const b = createRadio({ store });
    await b.load();
    expect(b.state.get().stations.some((s) => s.id === mine)).toBe(true);
    expect(b.state.get().stations.some((s) => s.id === BUILTIN_STATIONS[1]!.id)).toBe(false);
    expect(b.state.get().favorites).toEqual([mine]);
    expect(b.state.get().stationId).toBe(mine);
    expect(b.state.get().playing).toBe(false); // never auto-blasts audio on boot
  });

  it('survives a corrupt/hostile radio.json', async () => {
    await store.write('radio.json', { custom: [{ name: 'x', url: 'javascript:1' }, 'str', null], removed: [1, 'fip'], favorites: ['ghost'], last: 'ghost' });
    const r = createRadio({ store });
    await r.load();
    expect(r.state.get().stations.some((s) => s.url.startsWith('javascript'))).toBe(false);
    expect(r.state.get().favorites).toEqual([]);
    expect(r.state.get().stationId).toBeNull();
  });

  it('yields to another source that starts later, but not during its own startup', async () => {
    let t = 1_000_000;
    const r = mk({ now: () => t });
    await r.command({ cmd: 'play' });
    t += 1000;
    r.notifyMediaPlaying(true); // Spotify's stale "playing" poll right after we paused it
    expect(r.state.get().playing).toBe(true);
    t += 10_000;
    r.notifyMediaPlaying(true); // user genuinely started Spotify later
    expect(r.state.get().playing).toBe(false);
  });
});

describe('radio stream proxy', () => {
  it('strips ICY metadata from the audio, reports now-playing, and goes to "playing"', async () => {
    const up = fakeIcecast();
    const upPort = await listen(up.server);
    const r = mk();
    await r.command({ cmd: 'add', name: 'Fake', url: `http://127.0.0.1:${upPort}/live` });
    const id = r.state.get().stations.at(-1)!.id;
    await r.command({ cmd: 'play', id });
    const port = await listen(relay(r));

    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/${id}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    const reader = res.body!.getReader();
    let got = Buffer.alloc(0);
    while (got.length < 32 * 4) got = Buffer.concat([got, Buffer.from((await reader.read()).value!)]);
    ac.abort();

    expect(got.subarray(0, 32 * 4).every((b) => b === 0xab)).toBe(true); // no metadata bytes leaked
    expect(r.state.get().status).toBe('playing');
    expect(['First Song', 'Second Song']).toContain(r.state.get().nowPlaying);
  });

  it('closes the upstream connection when the player disconnects', async () => {
    let upstreamClosed = false;
    const up = fakeIcecast({ onClose: () => (upstreamClosed = true) });
    const upPort = await listen(up.server);
    const r = mk();
    await r.command({ cmd: 'add', name: 'Fake', url: `http://127.0.0.1:${upPort}/live` });
    const id = r.state.get().stations.at(-1)!.id;
    await r.command({ cmd: 'play', id });
    const port = await listen(relay(r));
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/${id}`, { signal: ac.signal });
    await res.body!.getReader().read();
    ac.abort();
    await waitFor(() => upstreamClosed, 'upstream to be closed (no leaked connection)');
  });

  it('reports upstream HTTP errors as a station error', async () => {
    const up = fakeIcecast({ status: 404 });
    const upPort = await listen(up.server);
    const r = mk();
    await r.command({ cmd: 'add', name: 'Dead', url: `http://127.0.0.1:${upPort}/gone` });
    const id = r.state.get().stations.at(-1)!.id;
    await r.command({ cmd: 'play', id });
    const port = await listen(relay(r));
    const res = await fetch(`http://127.0.0.1:${port}/${id}`);
    expect(res.status).toBe(502);
    expect(r.state.get()).toMatchObject({ status: 'error', error: expect.stringContaining('404') });
  });

  it('reports an unreachable station and 404s unknown ids', async () => {
    const r = mk();
    await r.command({ cmd: 'add', name: 'Nowhere', url: 'http://127.0.0.1:9/none' });
    const id = r.state.get().stations.at(-1)!.id;
    await r.command({ cmd: 'play', id });
    const port = await listen(relay(r));
    expect((await fetch(`http://127.0.0.1:${port}/${id}`)).status).toBe(502);
    expect(r.state.get().status).toBe('error');
    expect((await fetch(`http://127.0.0.1:${port}/not-a-station`)).status).toBe(404);
  });
});

describe('station search', () => {
  const rows = [
    { name: 'Good FM', url_resolved: 'https://good.test/live', url: 'http://old.test', tags: 'rock,pop,80s', favicon: 'https://good.test/i.png', lastcheckok: 1 },
    { name: 'Broken', url_resolved: 'https://broken.test/live', lastcheckok: 0 },
    { name: 'Evil', url_resolved: 'javascript:alert(1)', lastcheckok: 1 },
    { name: 'Good FM dup', url_resolved: 'https://good.test/live', lastcheckok: 1 },
  ];
  it('filters dead/unsafe/duplicate results and shapes stations', async () => {
    let seen = '';
    const fetchMock = (async (u: URL) => {
      seen = String(u);
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as unknown as typeof fetch;
    const r = mk({ fetch: fetchMock, searchBase: 'https://api.test' });
    const out = await r.search('  good  ');
    expect(seen).toContain('https://api.test/json/stations/search?name=good');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Good FM', url: 'https://good.test/live', genre: 'rock · pop', logo: 'https://good.test/i.png' });
  });
  it('does not query for tiny input and surfaces HTTP errors', async () => {
    let calls = 0;
    const r = mk({ fetch: (async () => (calls++, new Response('x', { status: 503 }))) as unknown as typeof fetch });
    expect(await r.search('a')).toEqual([]);
    expect(calls).toBe(0);
    await expect(r.search('jazz')).rejects.toThrow(/503/);
  });
});
