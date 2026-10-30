import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from '@headunit/shared';
import { config } from './config';
import { createMusic } from './connections/music';
import { LibraryError } from './library/library';
import { Observable } from './observable';
import { createCamera } from './providers/camera';
import { createSimDevices } from './demo/devicesSim';
import type { MediaProvider } from './providers/media';
import { createMockMedia } from './demo/mediaMock';
import { createMockProjection } from './demo/projection';
import { createVehicleSim } from './demo/vehicleSim';
import { createRadio } from './radio/radio';
import { createApp } from './server';
import { JsonStore } from './store';
import { createSimSystem } from './demo/system';

let dir: string;
let closers: Array<() => void> = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'srv-'))));
afterEach(async () => {
  for (const c of closers) c();
  closers = [];
  await rm(dir, { recursive: true, force: true });
});

async function boot(wrap: (m: MediaProvider) => MediaProvider = (m) => m) {
  const store = new JsonStore(dir);
  const settings = new Observable(DEFAULT_SETTINGS);
  // These tests exercise the library routes through `media`; the connections API is only needed to satisfy createApp.
  const music = createMusic({ store, settings, config });
  closers.push(() => music.dispose());
  const app = createApp({
    config: { ...config, dataDir: dir },
    store,
    vehicle: createVehicleSim(),
    media: wrap(createMockMedia()),
    connections: music.connections,
    system: createSimSystem(),
    projection: createMockProjection(),
    devices: createSimDevices(),
    radio: createRadio({ store }),
    camera: createCamera(),
    settings,
    layout: new Observable(DEFAULT_LAYOUT),
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  closers.push(() => app.close());
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const port = (app.server.address() as AddressInfo).port;
  return {
    /** fetch() forbids overriding Host, so DNS-rebinding checks need a raw request. */
    rawStatus: (p: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        r.on('error', reject);
        r.end();
      }),
    get: (p: string, init?: RequestInit) => fetch(base + p, init),
    post: (p: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  };
}

describe('library routes', () => {
  it('serves the library as JSON', async () => {
    const s = await boot();
    const home = await (await s.get('/api/library/home')).json();
    expect(Object.keys(home).sort()).toEqual(['playlists', 'recent', 'topArtists', 'topTracks']);
    expect((await (await s.get('/api/library/playlists')).json()).length).toBe(8);
    expect((await (await s.get('/api/library/albums')).json()).length).toBe(8);
    expect((await (await s.get('/api/library/artists')).json()).length).toBe(8);
    expect((await (await s.get('/api/library/liked')).json()).length).toBeGreaterThan(5);
    const pl = await (await s.get('/api/library/playlist/3')).json();
    expect(pl.tracks.map((t: { title: string }) => t.title)).toEqual(['Rearview', 'Overpass']);
    expect((await (await s.get('/api/library/album/1')).json()).item.name).toBe('Chrome Skies');
    const q = await (await s.get('/api/queue')).json();
    expect(q.current.title).toBeTruthy();
    expect((await (await s.get('/api/connect/devices')).json()).length).toBe(3);
  });

  it('searches', async () => {
    const s = await boot();
    const r = await (await s.get('/api/library/search?q=velvet')).json();
    expect(r.artists[0].name).toBe('Velvet Static');
    expect((await (await s.get('/api/library/search')).json()).tracks).toEqual([]);
  });

  it('responds 404 to unknown ids/paths and rejects path tricks', async () => {
    const s = await boot();
    const missing = await s.get('/api/library/playlist/999');
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/not found/i);
    expect((await s.get('/api/library/nope')).status).toBe(404);
    expect((await s.get('/api/library/playlist/..%2f..%2fetc')).status).toBe(404);
    expect((await s.get('/api/library/playlist/' + 'a'.repeat(100))).status).toBe(404);
  });

  it('likes a track and the player state follows', async () => {
    const s = await boot();
    const r = await s.post('/api/library/like', { uri: 'mock:track:2', on: true });
    expect(await r.json()).toEqual({ liked: true });
    expect((await (await s.get('/api/library/liked')).json()).some((t: { id: string }) => t.id === 'mock-2')).toBe(true);
    expect(await (await s.post('/api/library/like', { uri: 'mock:track:2', on: false })).json()).toEqual({ liked: false });
  });

  it('validates request bodies', async () => {
    const s = await boot();
    expect((await s.post('/api/library/like', { uri: 5, on: true })).status).toBe(404);
    expect((await s.post('/api/library/like', { uri: 'x', on: 'yes' })).status).toBe(404);
    expect((await s.post('/api/library/like', 'not json')).status).toBe(404);
    expect((await s.post('/api/library/like', { uri: 'x'.repeat(300), on: true })).status).toBe(404);
    expect((await s.post('/api/connect/transfer', { id: 7 })).status).toBe(404);
  });

  it('survives an oversized body', async () => {
    const s = await boot();
    const r = await s.post('/api/library/like', { uri: 'x', on: true, pad: 'p'.repeat(20_000) }).catch(() => null);
    expect(r === null || r.status >= 400).toBe(true);
    expect((await s.get('/api/health')).status).toBe(200); // server still up
  });

  it('transfers playback to another device', async () => {
    const s = await boot();
    expect((await s.post('/api/connect/transfer', { id: 'pixel' })).status).toBe(200);
    const devices = await (await s.get('/api/connect/devices')).json();
    expect(devices.find((d: { active: boolean }) => d.active).id).toBe('pixel');
    expect((await s.post('/api/connect/transfer', { id: 'nope' })).status).toBe(404);
  });

  it('refuses cross-site mutations (CSRF) but allows reads', async () => {
    const s = await boot();
    expect((await s.post('/api/library/like', { uri: 'mock:track:2', on: true }, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await s.post('/api/connect/transfer', { id: 'pixel' }, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect(await s.rawStatus('/api/library/home', 'evil.example.com')).toBe(403); // DNS rebinding
    expect(await s.rawStatus('/api/library/home', 'localhost:8787')).toBe(200);
  });

  it('turns service errors into the right HTTP status and a code the UI understands', async () => {
    const fail = (e: LibraryError) => (m: MediaProvider): MediaProvider => ({ ...m, library: { ...m.library, liked: async () => Promise.reject(e) } });
    for (const [code, status] of [['scope', 401], ['auth', 401], ['rate', 429], ['unavailable', 502]] as const) {
      const s = await boot(fail(new LibraryError(`boom ${code}`, code)));
      const r = await s.get('/api/library/liked');
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: `boom ${code}`, code });
    }
  });

  it('does not leak internals on an unexpected error', async () => {
    const s = await boot((m) => ({ ...m, library: { ...m.library, liked: async () => Promise.reject(new Error('secret /home/user/path')) } }));
    const r = await s.get('/api/library/liked');
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('secret');
  });
});
