import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  SERVICE_INFO,
  SERVICE_NAMES,
  arrangementsCorrected,
  layoutOrDefault,
  mergeSettings,
  sanitizeLayout,
  sanitizeSettings,
  type ConnectionsResponse,
  type DashboardLayout,
  type MusicService,
  type SaveConnectionRequest,
  type ServerMessage,
  type Settings,
  type Snapshot,
} from '@headunit/shared';
import type { Config } from './config';
import { ConnectionError, isMusicService, type ConnectionsApi } from './connections/music';
import { LibraryError } from './library/library';
import { Observable } from './observable';
import { BodyTooLarge, json, readJson } from './http';
import { parseClientMessage } from './protocol';
import { isAllowedHost, isAllowedOrigin } from './security';
import type { JsonStore } from './store';
import type { MediaProvider } from './providers/media';
import type { CameraProvider } from './providers/camera';
import type { DevicesProvider } from './providers/devices';
import type { ProjectionProvider } from './providers/projection';
import { createAndroidAutoDev, type AndroidAutoDevProvider } from './androidAutoDev';
import type { RadioProvider } from './radio/radio';
import type { VehicleProvider } from './providers/vehicle';
import type { SystemProvider } from './system/system';
import type { SpotifyConnectReceiver } from './spotifyConnect';
import type { HardwareInputProvider } from './hardwareInput';
import { createWallpapers, uploadWallpaper } from './wallpapers';
import { GpsCenter } from './gpsCenter';
import { WledCenter } from './wledCenter';
import { DashcamCenter } from './dashcamCenter';
import { usbPhoneStatus } from './usbAuto';
import { createYouTubeMusic, YouTubeError } from './youtube/youtube';
import { createFeatures, type FeatureDeps, type Features } from './features';
import { applyDownloadedUpdate, applyUpdate, receiveUpdateZip, rollbackUpdate, updateStatus } from './updater';
import { CONNECTIVITY_ACTIONS, runConnectivityHelper } from './connectivity';
import { AudioMeter } from './audioMeter';
import { createBootStudio, configScript } from './bootStudio';

const MAX_ART_BYTES = 8 * 1024 * 1024;
const ART_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);

/** Keep the album-art proxy from becoming a localhost/private-network fetch endpoint. */
function publicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const octets = address.split('.').map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (kind === 6) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1') return false;
    if (v.startsWith('::ffff:')) return publicAddress(v.slice(7));
    const first = parseInt(v.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return false; // multicast
    return true;
  }
  return false;
}

async function checkedArtUrl(raw: string): Promise<URL> {
  if (raw.length === 0 || raw.length > 4096) throw new Error('bad artwork address');
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported artwork address');
  if (u.username || u.password) throw new Error('credentials are not allowed in artwork addresses');
  if (isIP(u.hostname)) {
    if (!publicAddress(u.hostname)) throw new Error('private artwork address refused');
  } else {
    if (u.hostname === 'localhost' || !u.hostname.includes('.')) throw new Error('local artwork address refused');
    const answers = await lookup(u.hostname, { all: true, verbatim: true });
    if (answers.length === 0 || answers.some((a) => !publicAddress(a.address))) throw new Error('private artwork address refused');
  }
  return u;
}

/** Fetch a small public raster image, validating every redirect. */
async function fetchArtwork(raw: string): Promise<{ body: Buffer; type: string }> {
  let u = await checkedArtUrl(raw);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const r = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1', 'User-Agent': 'RPI-Head-Unit/1.0' },
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc || redirects === 4) throw new Error('too many artwork redirects');
      u = await checkedArtUrl(new URL(loc, u).toString());
      continue;
    }
    if (!r.ok) throw new Error(`artwork server returned ${r.status}`);
    const type = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ART_TYPES.has(type)) throw new Error('artwork is not a supported raster image');
    const declared = Number(r.headers.get('content-length') ?? 0);
    if (declared > MAX_ART_BYTES) throw new Error('artwork is too large');
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length === 0 || body.length > MAX_ART_BYTES) throw new Error('artwork is too large');
    return { body, type };
  }
  throw new Error('artwork fetch failed');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface AppDeps {
  config: Config;
  store: JsonStore;
  gps?: GpsCenter;
  wled?: WledCenter;
  dashcam?: DashcamCenter;
  vehicle: VehicleProvider;
  /** The music hub: whichever real service is active right now. */
  media: MediaProvider;
  /** Client IDs and sign-in for each music service (Settings > Music services). */
  connections: ConnectionsApi;
  system: SystemProvider;
  projection: ProjectionProvider;
  androidAutoDev?: AndroidAutoDevProvider;
  devices: DevicesProvider;
  radio: RadioProvider;
  camera: CameraProvider;
  settings: Observable<Settings>;
  spotifyConnect?: SpotifyConnectReceiver;
  /** Optional Linux evdev listener for USB volume/media knobs. */
  hardware?: HardwareInputProvider;
  layout: Observable<DashboardLayout>;
  /** Simulated hardware (started with --demo). Reported to the UI so it can label everything as a demo. */
  demo?: boolean;
  /** The v2 features (trips, garage, weather, ...). Built here when not given; the caller starts them with `app.features.start()`. */
  features?: Features;
  /** Outbound requests of the v2 features (weather, lyrics, quick actions). Tests replace it; production uses the global one. */
  fetch?: typeof fetch;
  /** The FM transmitter's network, processes and sockets. Tests replace them; production uses the real ones. */
  fm?: FeatureDeps['fm'];
}

/** Compare a secret in constant time, so the time a wrong guess takes says nothing about how much of it was right. */
function sameSecret(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * What to tell the user when the provider sent the browser back with `error=` instead of a code. The provider's own
 * description is shown too (shortened; the page escapes it), because it usually names the exact setting that is wrong.
 */
export function authErrorMessage(service: MusicService, error: string, description: string | null): string {
  const label = SERVICE_INFO[service].label;
  const code = error.slice(0, 80);
  const said = description?.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 160);
  const detail = said ? ` ${label} says: “${said}”.` : '';
  if (code === 'access_denied') return 'You chose not to allow access, so nothing was connected.';
  if (code === 'invalid_scope') {
    return service === 'tidal'
      ? `TIDAL refused the permissions this head unit asked for (invalid_scope).${detail} In the TIDAL developer dashboard, enable user.read and playback for your app (and any extra ones listed under Settings → Music services → TIDAL → Permissions, or clear that field), then sign in again.`
      : `${label} refused the permissions this head unit asked for (invalid_scope).${detail} Sign in again.`;
  }
  if (code === 'unauthorized_client' || code === 'invalid_client') {
    return `${label} does not accept this Client ID (${code}).${detail} Check that the Client ID in Settings → Music services is the one from your ${label} developer app.`;
  }
  if (code === 'invalid_request') {
    return `${label} refused the sign-in request (invalid_request).${detail} Check that the Redirect URI shown in Settings → Music services is registered in your ${label} developer app exactly, then sign in again.`;
  }
  return `${label} said: ${code}.${detail} Try signing in again.`;
}

export async function loadPersisted(store: JsonStore) {
  const settings = sanitizeSettings(await store.read('settings.json'));
  const layout = layoutOrDefault(await store.read('layout.json'));
  return { settings, layout };
}

export function createApp(deps: AppDeps): { server: Server; close(): void; features: Features } {
  const { config, store, media, connections, system, projection, vehicle, settings, layout, devices, radio, camera, spotifyConnect, hardware } = deps;
  const gps = deps.gps ?? new GpsCenter(store);
  const wled = deps.wled ?? new WledCenter(store);
  const dashcam = deps.dashcam ?? new DashcamCenter(store, config.dataDir);
  const androidAutoDev = deps.androidAutoDev ?? createAndroidAutoDev({...config.androidAutoDev, enabled:false}, projection);
  const uiRoot = resolve(config.uiDist);
  const youtube = createYouTubeMusic({ store, envApiKey: config.youtube.apiKey });
  const wallpapers = createWallpapers(config.wallpapersDir);
  const audioMeter = new AudioMeter();
  const bootStudio = createBootStudio(config.dataDir, config.projectDir);
  void bootStudio.prepare().catch((e) => console.error('[boot studio] could not restore saved boot theme', e));
  const features =
    deps.features ??
    createFeatures({
      store,
      config,
      settings,
      layout,
      vehicle,
      gps,
      wled,
      dashcam,
      media,
      radio,
      demo: Boolean(deps.demo),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.fm ? { fm: deps.fm } : {}),
      // The server changing settings or the layout itself (a restored backup): keep, save and tell every screen.
      applySettings: async (next) => {
        settings.set(next);
        await store.write('settings.json', next);
        broadcast({ t: 'settings', data: next });
      },
      applyLayout: async (next) => {
        layout.set(next);
        await store.write('layout.json', next);
        broadcast({ t: 'layout', data: next });
      },
    });

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        if (!res.headersSent) {
          res.setHeader('Connection', 'close'); // don't wait for the rest of an oversized upload
          json(res, 413, { error: 'That request is too large.' });
        } else res.end();
        return;
      }
      console.error('[http]', err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!isAllowedHost(req.headers.host, config.allowedHosts)) return json(res, 403, { error: 'bad host' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (method !== 'GET' && method !== 'HEAD' && !isAllowedOrigin(req.headers.origin, config.allowedHosts)) {
      return json(res, 403, { error: 'bad origin' });
    }

    // Boot Studio edits the independent file:// splash without changing OS boot files.
    // The preview uses exactly the same runtime as the kiosk screen, but never
    // switches the user's appearance editor away to the dashboard.
    if (url.pathname === '/api/boot-studio' && method === 'GET') {
      return json(res, 200, await bootStudio.config());
    }
    if (url.pathname === '/api/boot-studio' && method === 'PUT') {
      try { return json(res, 200, await bootStudio.save(await readJson(req, 16 * 1024))); }
      catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : 'Could not save boot appearance' }); }
    }
    if (url.pathname === '/api/boot-studio/upload' && method === 'POST') {
      try { return json(res, 201, await bootStudio.upload(req, url.searchParams.get('slot') ?? '')); }
      catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : 'Could not upload image' }); }
    }
    if (method === 'GET' && url.pathname === '/api/boot-studio/preview') {
      const html = readFileSync(join(bootStudio.root, 'loading.html'), 'utf8');
      const previewHtml = html.replace('<style>', '<base href="/api/boot-studio/assets/"><style>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(previewHtml);
    }
    if (method === 'GET' && url.pathname.startsWith('/api/boot-studio/assets/')) {
      const name=url.pathname.slice('/api/boot-studio/assets/'.length);
      if (name === 'boot-runtime.js' || name === 'boot-config.js') {
        const body=name==='boot-config.js' ?
          configScript(await bootStudio.config()) :
          readFileSync(join(bootStudio.root, name), 'utf8');
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(body);
      }
      if (name.startsWith('art/')) {
        const asset=await bootStudio.asset(name.slice(4));
        if (asset) { res.writeHead(200, {'Content-Type': asset.mime, 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(asset.bytes); }
      }
      return json(res, 404, {error:'not found'});
    }
    if (url.pathname === '/api/health') return json(res, 200, { ok: true });
    // A real image beacon for the file:// boot splash. Only appears when the
    // built interface is on disk; no CORS exemptions or fake readiness progress.
    if (url.pathname === '/api/kiosk-ready.svg' && method === 'GET') {
      try {
        if (statSync(join(uiRoot, 'index.html')).size <= 0) throw new Error('missing UI');
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#ff2a93"/></svg>';
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': String(Buffer.byteLength(svg)), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(svg);
      } catch { return res.writeHead(503, { 'Cache-Control': 'no-store' }).end(); }
    }

    if (url.pathname === '/api/audio/meter' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return json(res, 200, audioMeter.state());
    }
    if (url.pathname === '/api/ui-health' && method === 'GET') {
      try {
        const file = join(uiRoot, 'index.html');
        const info = statSync(file);
        return json(res, 200, { ok: true, file, bytes: info.size });
      } catch (e) {
        return json(res, 503, { ok: false, error: e instanceof Error ? e.message : 'UI build unavailable' });
      }
    }
    // The v2 features: garage, trips, weather, timers, scenes, quick actions, notes, lyrics, backup.
    if (await features.handle(req, res, url, method)) return;
    if (url.pathname === '/api/connectivity/state' && method === 'GET') {
      try {
        return json(res, 200, await runConnectivityHelper('state'));
      } catch (e) {
        return json(res, 503, { error: e instanceof Error ? e.message : 'Connectivity controls are unavailable' });
      }
    }
    if (url.pathname === '/api/connectivity/action' && method === 'POST') {
      const body = await readJson(req) as { action?: unknown; payload?: unknown };
      const action = typeof body.action === 'string' ? body.action : '';
      if (!CONNECTIVITY_ACTIONS.has(action as any)) return json(res, 400, { error: 'Unknown connectivity action' });
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {};
      try {
        return json(res, 200, await runConnectivityHelper(action as any, payload));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Connectivity action failed' });
      }
    }
    // GPS from the local gpsd socket. No network maps or external GPS API required.
    if (url.pathname === '/api/gps/state' && method === 'GET') return json(res,200,gps.state.get());
    if (method === 'GET' && (url.pathname === '/api/gps/track.gpx' || url.pathname === '/api/gps/track.csv')) {
      const gpx = url.pathname.endsWith('.gpx');
      const body=gpx?gps.gpx():gps.csv();
      res.writeHead(200,{'Content-Type':gpx?'application/gpx+xml; charset=utf-8':'text/csv; charset=utf-8',
        'Content-Disposition':gpx?'attachment; filename=trip.gpx':'attachment; filename=trip.csv',
        'Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body);return;
    }
    if (url.pathname === '/api/gps/action' && method === 'POST') {
      try {const body=await readJson(req) as {action?:string};return json(res,200,await gps.command(body.action??''));}
      catch(e){return json(res,400,{error:(e as Error).message});}
    }
    if (url.pathname === '/api/lighting/state' && method === 'GET') return json(res,200,await wled.state());
    if (url.pathname === '/api/lighting/update' && method === 'POST') {
      try{await features.lighting.update(await readJson(req) as Parameters<WledCenter['update']>[0]);return json(res,200,await wled.state());}
      catch(e){return json(res,400,{error:(e as Error).message});}
    }
    if (url.pathname === '/api/dashcam/state' && method === 'GET') return json(res,200,await dashcam.state());
    if (url.pathname === '/api/dashcam/action' && method === 'POST') {
      try{const body=await readJson(req) as {action?:string;[key:string]:unknown};await features.dashcam.action(body.action??'',body);return json(res,200,await dashcam.state());}
      catch(e){return json(res,400,{error:(e as Error).message});}
    }
    // Protected notifications from a separately powered ESP32 impact/PIR/door sensor.
    if (url.pathname === '/api/security/event' && method === 'POST') {
      if (!sameSecret(req.headers['x-headunit-sensor-token'], config.sensorToken)) return json(res,403,{error:'Sensor token is not configured or is incorrect.'});
      const body=await readJson(req) as {kind?:string};
      try{return json(res,200,await dashcam.protect(body.kind??'motion'));}
      catch(e){return json(res,400,{error:(e as Error).message});}
    }
    if (url.pathname === '/api/android-auto/usb' && method === 'GET') {
      const configured=Boolean(config.projection.command) && !config.projection.command.includes('openauto-runtime.sh');
      return json(res,200,usbPhoneStatus(configured));
    }
    // /api/fm/* (the FM transmitter) is answered by features.handle above; see apps/server/src/fm/.
    if (url.pathname === '/api/spotify-connect/status' && method === 'GET') {
      return json(res, 200, spotifyConnect?.state.get() ?? { enabled: false, name: config.spotify.deviceName, state: 'disabled' });
    }
    if (url.pathname === '/api/spotify-connect/restart' && method === 'POST') {
      if (!spotifyConnect) return json(res, 503, { error: 'Spotify Connect receiver is unavailable' });
      spotifyConnect.restart();
      return json(res, 200, { ok: true });
    }

    // Same-origin raster proxy for album-art backdrops. Chromium on the Pi can otherwise display
    // a CDN image but refuse canvas reads, which prevents the colour/ambient background from rendering.
    if (url.pathname === '/api/art' && method === 'GET') {
      try {
        const art = await fetchArtwork(url.searchParams.get('url') ?? '');
        res.writeHead(200, {
          'Content-Type': art.type,
          'Content-Length': String(art.body.length),
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(art.body);
      } catch (e) {
        return json(res, 502, { error: e instanceof Error ? e.message : 'artwork fetch failed' });
      }
      return;
    }


    if (url.pathname === '/api/update/status' && method === 'GET') {
      return json(res, 200, await updateStatus(config));
    }
    if (url.pathname === '/api/update/apply' && method === 'POST') {
      try {
        const zip = await receiveUpdateZip(config, req);
        await applyUpdate(config, zip);
        return json(res, 200, { ok: true, restarting: true });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Update failed.' });
      }
    }
    if (url.pathname === '/api/update/apply-downloaded' && method === 'POST') {
      try {
        await applyDownloadedUpdate(config);
        return json(res, 200, { ok: true, restarting: true });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Downloaded update failed.' });
      }
    }
    if (url.pathname === '/api/update/rollback' && method === 'POST') {
      try {
        await rollbackUpdate(config);
        return json(res, 200, { ok: true, restarting: true });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Rollback failed.' });
      }
    }

    if (url.pathname === '/api/youtube/config') {
      try {
        if (method === 'GET') return json(res, 200, await youtube.config());
        if (method === 'PUT') {
          const body = (await readJson(req)) as { apiKey?: unknown };
          return json(res, 200, await youtube.saveConfig(body.apiKey));
        }
        if (method === 'DELETE') return json(res, 200, await youtube.clearConfig());
      } catch (e) {
        if (e instanceof YouTubeError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    if (url.pathname === '/api/youtube/search' && method === 'GET') {
      try {
        return json(res, 200, await youtube.search(url.searchParams.get('q') ?? ''));
      } catch (e) {
        if (e instanceof YouTubeError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }
    const ytPlaylist = /^\/api\/youtube\/playlist\/([A-Za-z0-9_-]{8,80})$/.exec(url.pathname);
    if (ytPlaylist && method === 'GET') {
      try {
        return json(res, 200, await youtube.playlist(ytPlaylist[1]!));
      } catch (e) {
        if (e instanceof YouTubeError) return json(res, e.status, { error: e.message });
        throw e;
      }
    }

    // Hand-off between the dashboard and the Android Auto app. Plain HTTP so anything — a GPIO
    // button script, a labwc keybinding, a steering-wheel adapter — can drive it with curl.
    if (url.pathname === '/api/projection' && method === 'GET') return json(res, 200, projection.state.get());
    if (url.pathname.startsWith('/api/projection/') && method === 'POST') {
      const action = url.pathname.slice('/api/projection/'.length);
      if (action !== 'launch' && action !== 'stop' && action !== 'toggle') return json(res, 404, { error: 'unknown action' });
      const show = action === 'launch' || (action === 'toggle' && projection.state.get().status !== 'active');
      await (show ? projection.launch() : projection.stop());
      return json(res, 200, projection.state.get());
    }

    // Android Auto developer Head Unit Server transport. ADB-over-phone-hotspot is primary;
    // USB ADB is kept as a fallback. Both expose the phone's tcp:5277 and relay it to the native receiver.
    if (url.pathname === '/api/android-auto/dev' && method === 'GET') return json(res, 200, androidAutoDev.state.get());
    if (url.pathname === '/api/android-auto/dev/pair' && method === 'POST') {
      try {
        const body = (await readJson(req)) as { endpoint?: unknown; code?: unknown };
        if (typeof body.endpoint !== 'string' || typeof body.code !== 'string') return json(res, 400, { error: 'Pairing address and code are required.' });
        await androidAutoDev.pairWifi(body.endpoint, body.code);
        return json(res, 200, androidAutoDev.state.get());
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Wireless debugging pairing failed.' });
      }
    }
    if (url.pathname === '/api/android-auto/dev/wifi-connect' && method === 'POST') {
      try {
        const body = (await readJson(req)) as { endpoint?: unknown };
        if (body.endpoint !== undefined && typeof body.endpoint !== 'string') return json(res, 400, { error: 'Wireless debugging address must be IP:port.' });
        await androidAutoDev.connectWifi(typeof body.endpoint === 'string' ? body.endpoint : undefined);
        return json(res, 200, androidAutoDev.state.get());
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Wireless ADB connection failed.' });
      }
    }
    if (url.pathname.startsWith('/api/android-auto/dev/') && method === 'POST') {
      const action = url.pathname.slice('/api/android-auto/dev/'.length);
      if (action !== 'refresh' && action !== 'connect' && action !== 'disconnect') return json(res, 404, { error: 'unknown action' });
      await androidAutoDev.command(action);
      return json(res, 200, androidAutoDev.state.get());
    }

    // Reverse camera overlay: wire the reverse light (GPIO) to these with a tiny script.
    if (url.pathname === '/api/camera' && method === 'GET') return json(res, 200, camera.state.get());
    if (url.pathname.startsWith('/api/camera/') && method === 'POST') {
      const action = url.pathname.slice('/api/camera/'.length);
      if (action !== 'show' && action !== 'hide' && action !== 'toggle') return json(res, 404, { error: 'unknown action' });
      camera[action]();
      return json(res, 200, camera.state.get());
    }

    if (url.pathname === '/api/radio/search' && method === 'GET') {
      try {
        return json(res, 200, await radio.search(url.searchParams.get('q') ?? ''));
      } catch (e) {
        return json(res, 502, { error: (e as Error).message });
      }
    }
    if (url.pathname.startsWith('/api/radio/stream/') && method === 'GET') {
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      await radio.stream(decodeURIComponent(url.pathname.slice('/api/radio/stream/'.length)), res, ac.signal);
      return;
    }

    // Background > Wallpaper: pictures the user put in data/wallpapers/. Read-only, by exact file name (see wallpapers.ts).
    if (url.pathname === '/api/wallpapers/upload' && method === 'POST') {
      const filename = url.searchParams.get('name') ?? '';
      try {
        const stored = await uploadWallpaper(req, config.wallpapersDir, filename);
        return json(res, 201, { name: stored, id: `user:${stored}` });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : 'Invalid picture.' });
      }
    }
    if (url.pathname === '/api/wallpapers' || url.pathname.startsWith('/api/wallpapers/')) {
      return wallpapers.handle(req, res, url.pathname);
    }

    if (url.pathname === '/api/spotify/player-credentials') {
      if (method !== 'GET') return json(res, 404, { error: 'not found' });
      const remote = req.socket.remoteAddress ?? '';
      const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (!local || (req.headers.origin && !isAllowedOrigin(req.headers.origin, config.allowedHosts))) {
        return json(res, 403, { error: 'Spotify playback credentials are available only to the local head-unit screen.' });
      }
      try {
        return json(res, 200, await connections.spotifyPlayerCredentials());
      } catch (e) {
        if (e instanceof ConnectionError) return json(res, e.status, { error: e.message });
        console.error('[spotify-player]', e);
        return json(res, 502, { error: 'Could not prepare Spotify playback. Sign in again and try once more.' });
      }
    }

    if (url.pathname === '/api/tidal/player-credentials') {
      if (method !== 'GET') return json(res, 404, { error: 'not found' });
      const remote = req.socket.remoteAddress ?? '';
      const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      // This response contains a short-lived access token. Require both a loopback socket and, when the browser sends
      // Origin, a head-unit origin. A random website open in Chromium must never be able to read player credentials.
      if (!local || (req.headers.origin && !isAllowedOrigin(req.headers.origin, config.allowedHosts))) {
        return json(res, 403, { error: 'TIDAL player credentials are available only to the local head-unit screen.' });
      }
      try {
        return json(res, 200, await connections.tidalPlayerCredentials());
      } catch (e) {
        if (e instanceof ConnectionError) return json(res, e.status, { error: e.message });
        console.error('[tidal-player]', e);
        return json(res, 502, { error: 'Could not prepare TIDAL playback. Check the TIDAL connection and try again.' });
      }
    }

    if (url.pathname.startsWith('/api/library/') || url.pathname === '/api/queue' || url.pathname.startsWith('/api/connect/')) {
      return libraryRoute(url, method, req, res);
    }

    if (url.pathname === '/api/connections' || url.pathname.startsWith('/api/connections/')) {
      return connectionsRoute(url, method, req, res);
    }
    if (url.pathname.startsWith('/auth/')) return authRoute(url, method, res);

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(url.pathname, res, method);
  }

  /** Settings > Music services: Client ID, sign-in, test and sign-out for each service. */
  async function connectionsRoute(url: URL, method: string, req: IncomingMessage, res: ServerResponse) {
    const m = /^\/api\/connections(?:\/([^/]+)(?:\/(login|paste|test))?)?$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'not found' });
    const [, name, action] = m;
    if (!name) {
      if (method !== 'GET') return json(res, 404, { error: 'not found' });
      return json(res, 200, { services: connections.list() } satisfies ConnectionsResponse);
    }
    if (!isMusicService(name)) return json(res, 404, { error: 'Unknown music service' });
    try {
      if (!action) {
        if (method === 'GET') return json(res, 200, connections.get(name));
        if (method === 'PUT') {
          const body = (await readJson(req)) as Partial<SaveConnectionRequest>;
          // Only connection fields are forwarded. TIDAL also needs its Client Secret; keep it server-side.
          return json(
            res,
            200,
            await connections.save(name, {
              clientId: body.clientId as string,
              ...(name === 'tidal' ? { clientSecret: body.clientSecret } : {}),
              redirectUri: body.redirectUri,
              scopes: body.scopes,
            }),
          );
        }
        if (method === 'DELETE') return json(res, 200, await connections.signOut(name, { forget: url.searchParams.get('forget') === '1' }));
      } else if (method === 'POST') {
        if (action === 'login') return json(res, 200, { url: connections.beginLogin(name) });
        const body = (await readJson(req)) as { text?: unknown };
        if (action === 'paste') return json(res, 200, await connections.paste(name, body.text as string));
        if (action === 'test') return json(res, 200, await connections.test(name));
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof ConnectionError) return json(res, e.status, { error: e.message });
      throw e;
    }
  }

  /** A small page for a browser that was sent here by the sign-in (or is about to be sent to the provider). */
  function authPage(res: ServerResponse, status: number, service: MusicService, heading: string, message: string, retry: boolean, retryCurrent = false) {
    const back = `<a href="${esc(config.uiUrl)}">Back to the head unit</a>`;
    // Empty href reloads the local callback with its original code/state. Only
    // offer it on transport failures, never after a definitive OAuth rejection.
    const exchangeAgain = retryCurrent ? `<a href="">Retry token exchange</a> &middot; ` : '';
    const again = retry ? `<a href="/auth/${service}/login">Try again</a> &middot; ` : '';
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The callback address carries the sign-in code; never pass it on as a Referer.
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${esc(heading)}</title><style>body{font:18px/1.5 system-ui,sans-serif;margin:0;padding:32px 24px;background:#0b0f14;color:#e8edf2}` +
        `a{color:#3dd5f3;display:inline-block;padding:10px 4px}</style></head><body><h1>${esc(heading)}</h1><p>${esc(message)}</p><p>${exchangeAgain}${again}${back}</p></body></html>`,
    );
  }

  /** Browser-facing sign-in: send the browser to the provider, take it back from the provider, sign out. */
  async function authRoute(url: URL, method: string, res: ServerResponse) {
    const m = /^\/auth\/([^/]+)\/(login|callback|logout)$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'not found' });
    const [, name, action] = m;
    if (!isMusicService(name)) return json(res, 404, { error: 'Unknown music service' });
    const label = SERVICE_INFO[name].label;

    if (action === 'login' && method === 'GET') {
      let location: string;
      try {
        location = connections.beginLogin(name);
      } catch (e) {
        if (!(e instanceof ConnectionError)) throw e;
        return authPage(res, e.status, name, `${label} sign-in couldn't start`, e.message, false);
      }
      res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }).end();
      return;
    }

    if (action === 'callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      const failed = (status: number, message: string) => {
        // Transport failures occur AFTER the provider has returned to this local
        // callback. Show a precise distinction from a failure to open the login
        // page; allow a single manual reload while the PKCE state still exists.
        const networkFailure = /(?:Couldn't reach|Could not reach|Could not connect securely)/i.test(message);
        const advice = networkFailure
          ? ' The provider approved access, but the Pi backend could not exchange the code yet. Try reloading this callback page once, or run the OAuth network diagnostic on the Pi.'
          : '';
        return authPage(res, networkFailure ? 502 : status, name, `${label} sign-in didn't finish`, message + advice, true, networkFailure);
      };
      if (err) {
        return failed(400, authErrorMessage(name, err, url.searchParams.get('error_description')));
      }
      if (!code || !state) return failed(400, 'The sign-in details were missing from this address. Start the sign-in again.');
      try {
        await connections.complete(name, code, state);
      } catch (e) {
        if (e instanceof ConnectionError) return failed(e.status, e.message);
        console.error('[auth]', e);
        return failed(500, 'Something went wrong on the head unit. Try again.');
      }
      res.writeHead(302, { Location: config.uiUrl, 'Referrer-Policy': 'no-referrer' }).end();
      return;
    }

    // Kept so anything that used the old Spotify-only address still works.
    if (action === 'logout' && method === 'POST') {
      await connections.signOut(name);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  /** Browse / search / queue / like / device switching, for whichever music service is active. */
  async function libraryRoute(url: URL, method: string, req: IncomingMessage, res: ServerResponse) {
    const lib = media.library;
    const path = url.pathname;
    try {
      if (method === 'GET') {
        if (path === '/api/library/home') return json(res, 200, await lib.home());
        if (path === '/api/library/playlists') return json(res, 200, await lib.playlists());
        if (path === '/api/library/liked') return json(res, 200, await lib.liked());
        if (path === '/api/library/albums') return json(res, 200, await lib.albums());
        if (path === '/api/library/artists') return json(res, 200, await lib.artists());
        if (path === '/api/library/search') return json(res, 200, await lib.search((url.searchParams.get('q') ?? '').slice(0, 100)));
        const m = /^\/api\/library\/(playlist|album)\/([\w-]{1,64})$/.exec(path);
        if (m) return json(res, 200, await (m[1] === 'playlist' ? lib.playlist(m[2]!) : lib.album(m[2]!)));
        if (path === '/api/queue') return json(res, 200, await lib.queue());
        if (path === '/api/connect/devices') return json(res, 200, await lib.devices());
      } else if (method === 'POST' || method === 'PUT') {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (path === '/api/connect/transfer' && typeof body.id === 'string' && body.id.length <= 128) {
          await lib.transfer(body.id);
          return json(res, 200, { ok: true });
        }
        if (path === '/api/library/like' && typeof body.uri === 'string' && body.uri.length <= 200 && typeof body.on === 'boolean') {
          return json(res, 200, { liked: await lib.setLiked(body.uri, body.on) });
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof LibraryError) {
        const status = e.code === 'auth' || e.code === 'scope' ? 401 : e.code === 'rate' ? 429 : e.code === 'unavailable' ? 502 : 404;
        return json(res, status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
      throw e;
    }
  }

  // The kiosk UI is served from the local build. Keep this path deliberately synchronous and
  // tiny: on the Pi we observed fs/promises static reads hanging while /api/health stayed healthy,
  // which left Chromium on a blank "Untitled" page. Local dist files are small and live on the
  // same filesystem, so synchronous stat/read here is both deterministic and fast enough.
  function serveStatic(pathname: string, res: ServerResponse, method = 'GET') {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }

    // Always resolve inside uiRoot. Leading slashes are URL syntax, not filesystem roots.
    const rel = normalize(decoded).replace(/^[/\\]+/, '');
    let file = join(uiRoot, rel);
    if (file !== uiRoot && !file.startsWith(uiRoot + sep)) {
      res.writeHead(403).end();
      return;
    }

    let isAsset = Boolean(extname(file));
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      if (isAsset) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      file = join(uiRoot, 'index.html'); // SPA fallback
      isAsset = false;
    }

    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': String(body.length),
        'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
    } catch (err) {
      console.error('[ui-static]', file, err);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('UI not built — run `npm run build`, or use `npm run dev`.');
    }
  }

  // ---- WebSocket --------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const ok =
      new URL(req.url ?? '/', 'http://localhost').pathname === '/ws' &&
      isAllowedHost(req.headers.host, config.allowedHosts) &&
      isAllowedOrigin(req.headers.origin, config.allowedHosts);
    if (!ok) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const broadcast = (m: ServerMessage, except?: WebSocket) => {
    const data = JSON.stringify(m);
    for (const c of clients) if (c !== except && c.readyState === c.OPEN) c.send(data);
  };

  const snapshot = (): Snapshot => ({
    settings: settings.get(),
    layout: layout.get(),
    vehicle: vehicle.state.get(),
    media: media.state.get(),
    system: system.state.get(),
    projection: projection.state.get(),
    androidAutoDev: androidAutoDev.state.get(),
    devices: devices.state.get(),
    radio: radio.state.get(),
    camera: camera.state.get(),
    diagnostics: vehicle.diagnostics.get(),
    svc: Object.fromEntries(SERVICE_NAMES.map((name) => [name, features.services[name].get()])) as Snapshot['svc'],
    ...(deps.demo ? { demo: true } : {}),
  });

  const unsubs = [
    vehicle.state.subscribe((data) => broadcast({ t: 'vehicle', data })),
    media.state.subscribe((data) => broadcast({ t: 'media', data })),
    system.state.subscribe((data) => broadcast({ t: 'system', data })),
    projection.state.subscribe((data) => broadcast({ t: 'projection', data })),
    androidAutoDev.state.subscribe((data) => broadcast({ t: 'android-auto-dev', data })),
    devices.state.subscribe((data) => broadcast({ t: 'devices', data })),
    radio.state.subscribe((data) => broadcast({ t: 'radio', data })),
    camera.state.subscribe((data) => broadcast({ t: 'camera', data })),
    vehicle.diagnostics.subscribe((data) => broadcast({ t: 'diagnostics', data })),
  ];
  if (hardware) unsubs.push(hardware.events.subscribe((data) => broadcast({ t: 'hardware', data })));
  // Every named service (GPS, trips, garage, ...) is pushed to the screens whenever it changes.
  for (const name of SERVICE_NAMES) {
    unsubs.push((features.services[name] as Observable<unknown>).subscribe((data) => broadcast({ t: 'svc', name, data } as ServerMessage)));
  }

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, { t: 'snapshot', ...snapshot() });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return;
      switch (msg.t) {
        case 'media':
          void media.command(msg.command).catch((e) => console.error('[media]', e));
          break;
        case 'system':
          void system.apply(msg.patch);
          break;
        case 'settings': {
          try {
            const next = mergeSettings(settings.get(), msg.patch);
            settings.set(next);
            void store.write('settings.json', next);
            broadcast({ t: 'settings', data: next }, ws);
            // The sender applied the same merge to its own copy, but to the copy it HAD. When the rail, launcher or Quick Panel came out
            // different from what it wrote (repaired, or the patch was refused), it gets the real result too, so the two cannot drift apart.
            if (arrangementsCorrected(msg.patch, next)) send(ws, { t: 'settings', data: next });
          } catch (err) {
            // A listener of the settings (or a bug) must not take the whole head unit down because of one frame from one screen.
            console.error('[settings] could not apply a patch from a screen:', err);
          }
          break;
        }
        case 'layout': {
          const next = sanitizeLayout(msg.data);
          if (!next) {
            // Don't fail silently: tell the sender the truth so client and server can't drift apart.
            console.warn('[layout] rejected invalid layout from client; resyncing it');
            send(ws, { t: 'snapshot', ...snapshot() });
            break;
          }
          layout.set(next);
          void store.write('layout.json', next);
          broadcast({ t: 'layout', data: next }, ws);
          break;
        }
        case 'device':
          void devices.command(msg.command).catch((e) => console.error('[devices]', e));
          break;
        case 'radio':
          void radio.command(msg.command).catch((e) => console.error('[radio]', e));
          break;
        case 'camera':
          camera[msg.command]();
          break;
        case 'diagnostics':
          void (msg.command === 'read' ? vehicle.readDtcs() : vehicle.clearDtcs()).catch((e) => console.error('[diagnostics]', e));
          break;
        case 'projection':
          void (msg.command === 'launch' ? projection.launch() : projection.stop()).catch((e) => console.error('[projection]', e));
          break;
        case 'android-auto-dev':
          void androidAutoDev.command(msg.command).catch((e) => console.error('[android-auto-dev]', e));
          break;
      }
    });
  });

  return {
    server,
    features,
    close() {
      features.stop();
      audioMeter.close();
      for (const u of unsubs) u();
      for (const c of clients) c.terminate();
      wss.close();
      server.close();
    },
  };
}
