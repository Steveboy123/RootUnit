import { createServer, type Server } from 'node:http';

/**
 * The head-unit kiosk serves its actual UI and OAuth handlers on :8787. Spotify's
 * registered loopback callback is :5173. This second *loopback-only* listener
 * forwards the authorization callback (and nothing else) to the existing handler.
 *
 * In development, Vite already owns :5173 and proxies /auth to the backend, so
 * this bridge is only enabled for the built production app.
 */
export const SPOTIFY_LOOPBACK_REDIRECT = 'http://127.0.0.1:5173/auth/spotify/callback';
export const SPOTIFY_BRIDGE_PORT = 5173;

export function createSpotifyCallbackBridge(backendPort: number): Server {
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) {
    throw new Error('Invalid Spotify callback backend port');
  }
  return createServer((req, res) => {
    const raw = req.url ?? '';
    // No static files, API, full UI or arbitrary redirects on this listener.
    if (req.method !== 'GET' || raw.length > 4096 || !raw.startsWith('/auth/spotify/callback') ||
        new URL(raw, 'http://127.0.0.1').pathname !== '/auth/spotify/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Not found');
      return;
    }
    // URL is a path, never a client-supplied host; Spotify's code and state are
    // preserved verbatim. The main backend verifies the OAuth state/PKCE challenge.
    res.writeHead(302, {
      Location: `http://127.0.0.1:${backendPort}${raw}`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end();
  });
}

export function startSpotifyCallbackBridge(redirectUri: string, backendPort: number): Server | null {
  if (redirectUri !== SPOTIFY_LOOPBACK_REDIRECT || backendPort === SPOTIFY_BRIDGE_PORT) return null;
  const server = createSpotifyCallbackBridge(backendPort);
  server.on('error', (err) => {
    console.error(`[headunit] Spotify callback on 127.0.0.1:${SPOTIFY_BRIDGE_PORT} is unavailable:`,
      err instanceof Error ? err.message : 'listener error');
  });
  server.listen(SPOTIFY_BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`[headunit] Spotify sign-in callback ready on 127.0.0.1:${SPOTIFY_BRIDGE_PORT}`);
  });
  return server;
}
