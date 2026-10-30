import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSpotifyCallbackBridge, SPOTIFY_LOOPBACK_REDIRECT } from './spotifyCallbackBridge';

const opened: Server[] = [];
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  opened.push(server);
  return (server.address() as AddressInfo).port;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('production Spotify 5173 callback bridge', () => {
  it('forwards the exact OAuth code/state to the existing backend callback', async () => {
    let reached = '';
    const backend = createServer((req, res) => {
      reached = req.url ?? '';
      res.writeHead(200);
      res.end('completed');
    });
    const backendPort = await listen(backend);
    const callbackPort = await listen(createSpotifyCallbackBridge(backendPort));
    const payload = '/auth/spotify/callback?code=test-code&state=test-state';
    const first = await fetch(`http://127.0.0.1:${callbackPort}${payload}`, { redirect: 'manual' });
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(`http://127.0.0.1:${backendPort}${payload}`);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await fetch(first.headers.get('location')!)).status).toBe(200);
    expect(reached).toBe(payload);
    expect(SPOTIFY_LOOPBACK_REDIRECT).toBe('http://127.0.0.1:5173/auth/spotify/callback');
  });
  it('does not serve arbitrary pages or other apps through port 5173', async () => {
    const port = await listen(createSpotifyCallbackBridge(8787));
    for (const path of ['/', '/api/health', '/auth/tidal/callback', '/auth/spotify/callback-evil']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' })).status).toBe(404);
    }
    expect((await fetch(`http://127.0.0.1:${port}/auth/spotify/callback`, { method: 'POST' })).status).toBe(404);
  });
});
