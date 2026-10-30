import { createHash, randomBytes } from 'node:crypto';
import type { ConnectionProblem, MediaCommand, MediaState, MediaTrack, RepeatMode, TestConnectionResult } from '@headunit/shared';
import { parsePastedLogin } from '../connections/paste';
import type { MusicServiceProvider, ServiceAuthInfo } from '../connections/service';
import { createSpotifyLibrary, readApiMessage } from '../library/spotifyLibrary';
import { retryableSpotifyConnection, spotifyNetworkFailure } from './spotifyNetwork';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'user-read-email',
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  // Library features (Liked Songs, saved albums, followed artists, top items, history, like button):
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'user-top-read',
  'user-read-recently-played',
].join(' ');
const TOKEN_FILE = 'spotify.json';

/**
 * How long a Spotify sign-in is expected to last. Spotify has said refresh tokens now expire about six months
 * after the user approved the app. That figure comes from a third-party guide, NOT from Spotify's OpenAPI spec,
 * so it only drives the "about" estimate shown to the user; the real signal is `invalid_grant` on a refresh.
 */
const LOGIN_LIFETIME_MS = 180 * 24 * 3600_000;
/**
 * Minimum pause after a 429 whose message says the app is out of quota. A third-party guide says Spotify tells
 * "quota" apart from plain rate limiting; the spec documents neither (its error object is only {status, message}),
 * so this matches on the message text and stays tolerant when the wording differs.
 */
const QUOTA_BACKOFF_MS = 120_000;
/** Ignore absurd Retry-After values so one odd response can't stall the player for hours. */
const MAX_RETRY_AFTER_S = 3600;

const MSG_EXPIRED = 'Spotify says your sign-in has expired (they last about six months). Sign in again.';
const MSG_REJECTED = "Spotify doesn't recognise this Client ID — check it matches your app";
const MSG_PERMISSIONS = "Spotify didn't grant a permission this feature needs. Sign in again and approve everything it asks for.";
const MSG_QUOTA = 'Spotify says this app has used up its quota for now. It will try again in a few minutes.';
const MSG_OFFLINE = "Couldn't reach Spotify — check the Pi's internet connection";

const b64url = (b: Buffer) => b.toString('base64url');
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

/** What `spotify.json` holds (mode 0600). The access/refresh tokens are the only secrets. */
interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Epoch ms of the sign-in itself. A refresh keeps it, so the six-month estimate counts from the approval. */
  obtainedAt?: number;
  /** Space-separated permissions Spotify granted, from the token response. */
  scope?: string;
  /** The Client ID these tokens were issued to; tokens are useless with any other one. */
  clientId?: string;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

/** The token endpoint said no. Carries Spotify's `error` code (e.g. invalid_grant), never a token. */
class TokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface SpotifyDeps {
  config: { clientId: string; redirectUri: string; deviceName: string; pollMs: number };
  store: JsonStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export type SpotifyProvider = MusicServiceProvider & {
  /** Run one poll cycle now (exposed for tests). */
  poll(): Promise<void>;
};

/** Shown instead of a stale title while Spotify plays an advert (the API sends no item for those). */
const AD_TRACK: MediaTrack = { id: 'ad', title: 'Advertisement', artist: 'Spotify', album: '', durationMs: 0 };

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseTrack(item: any): MediaTrack | null {
  if (!item) return null;
  if (item.type === 'episode') {
    return {
      id: item.id,
      uri: typeof item.uri === 'string' ? item.uri : undefined,
      title: item.name,
      // `show.publisher` is deprecated in Spotify's reference; fall back to the show's name.
      artist: item.show?.publisher ?? item.show?.name ?? '',
      album: item.show?.name ?? '',
      artUrl: item.images?.[0]?.url,
      durationMs: item.duration_ms ?? 0,
    };
  }
  return {
    id: item.id ?? item.uri ?? item.name,
    uri: typeof item.uri === 'string' ? item.uri : undefined,
    title: item.name ?? 'Unknown',
    artist: (item.artists ?? []).map((a: any) => a.name).join(', '),
    album: item.album?.name ?? '',
    artUrl: item.album?.images?.[0]?.url,
    durationMs: item.duration_ms ?? 0,
  };
}

export function createSpotifyMedia(deps: SpotifyDeps): SpotifyProvider {
  const { config, store } = deps;
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;

  let tokens: Tokens | null = null;
  let loading: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let backoffUntil = 0;
  /** The last unrecoverable-or-actionable failure, shown in Settings until a sign-in or sign-out clears it. */
  let problem: { kind: ConnectionProblem; message: string } | null = null;
  /** The last shuffle/repeat request still in flight: Spotify doesn't order player calls, so play waits for it. */
  let ordering: Promise<unknown> = Promise.resolve();
  let likedFor: string | null = null; // the track id whose liked-state we last looked up
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const pending = new Map<string, { verifier: string; expires: number }>();
  const finishing = new Set<string>();

  const state = new Observable<MediaState>({
    provider: 'spotify',
    status: 'needs-auth',
    playing: false,
    track: null,
    progressMs: 0,
    progressTs: now(),
    volume: 50,
    shuffle: false,
    repeat: 'off',
  });

  const library = createSpotifyLibrary({ api: (m, p, b) => api(m, p, b), isPlaying: () => state.get().playing });

  /** Look up whether the current track is saved (once per track; failures just leave it unknown). */
  async function refreshLiked() {
    const t = state.get().track;
    if (!t || t.id === likedFor) return;
    likedFor = t.id;
    const uri = t.uri ?? `spotify:track:${t.id}`;
    if (t.id === AD_TRACK.id || !uri.startsWith('spotify:track:')) return; // adverts and podcast episodes can't be "liked" here
    const liked = await library.contains(uri);
    if (state.get().track?.id === t.id) state.update({ liked });
  }

  /** Read the saved tokens once. Started at creation so `connection()` can answer before the first request. */
  function loadTokens(): Promise<void> {
    return (loading ??= (async () => {
      const raw = (await store.read(TOKEN_FILE)) as Partial<Tokens> | null;
      // Tokens issued to a different Client ID can never work with this one.
      if (raw?.refreshToken && raw.accessToken && typeof raw.expiresAt === 'number' && (!raw.clientId || raw.clientId === config.clientId)) {
        tokens = {
          accessToken: raw.accessToken,
          refreshToken: raw.refreshToken,
          expiresAt: raw.expiresAt,
          obtainedAt: typeof raw.obtainedAt === 'number' ? raw.obtainedAt : undefined,
          scope: typeof raw.scope === 'string' ? raw.scope : undefined,
          clientId: raw.clientId,
        };
      }
    })());
  }
  void loadTokens();

  async function saveTokens(t: Tokens | null) {
    tokens = t && { ...t, clientId: config.clientId };
    await store.write(TOKEN_FILE, tokens);
  }

  function setProblem(kind: ConnectionProblem, message: string) {
    problem = { kind, message };
  }

  /** What the player should say when there is no usable sign-in (a "permissions" problem still has one). */
  const signInMessage = () => (problem && problem.kind !== 'permissions' ? problem.message : undefined);

  async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    // A broken first DNS/IPv6 route can make Node fetch fail even while Chromium
    // reaches Spotify's approval page. Retry only DNS/connection-setup errors.
    // Do not retry arbitrary errors: an OAuth authorization code is single-use.
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await f(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, ...params }),
          signal: AbortSignal.timeout(12000),
        });
        break;
      } catch (err) {
        if (attempt === 0 && retryableSpotifyConnection(err)) {
          await new Promise((resolve) => setTimeout(resolve, 650));
          continue;
        }
        // Never log the request body (it contains the one-use Spotify code).
        console.warn('[spotify-auth] token endpoint could not be reached:', spotifyNetworkFailure(err));
        throw err;
      }
    }
    if (!res.ok) {
      let code: string | undefined;
      try {
        const e = ((await res.json()) as any)?.error;
        if (typeof e === 'string' && /^[a-z_]{1,40}$/.test(e)) code = e;
      } catch {
        // No JSON body: the status alone has to do.
      }
      throw new TokenError(`Spotify's sign-in service refused the request (${res.status}${code ? ` ${code}` : ''})`, res.status, code);
    }
    let j: any;
    try {
      j = await res.json();
    } catch {
      throw new TokenError("Spotify's sign-in service sent an unreadable answer", 502);
    }
    if (typeof j?.access_token !== 'string' || !j.access_token) throw new TokenError("Spotify's sign-in service sent an incomplete answer", 502);
    return {
      accessToken: j.access_token,
      refreshToken: typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : undefined,
      expiresIn: typeof j.expires_in === 'number' ? j.expires_in : 3600,
      scope: typeof j.scope === 'string' ? j.scope : undefined,
    };
  }

  /** One refresh at a time: Spotify may rotate the refresh token, so two parallel refreshes could invalidate each other. */
  function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const run = (async () => {
      const cur = tokens;
      if (!cur) return;
      const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refreshToken });
      await saveTokens({
        accessToken: r.accessToken,
        // Refresh responses may omit a new refresh token — keep the old one.
        refreshToken: r.refreshToken ?? cur.refreshToken,
        expiresAt: now() + r.expiresIn * 1000,
        obtainedAt: cur.obtainedAt, // a refresh is not a new sign-in
        scope: r.scope ?? cur.scope,
      });
    })();
    refreshing = run;
    const done = () => {
      if (refreshing === run) refreshing = null;
    };
    run.then(done, done);
    return run;
  }

  async function accessToken(forceRefresh = false): Promise<string | null> {
    await loadTokens();
    if (!tokens) return null;
    // Spotify doesn't know this app: renewing again would only repeat the refusal on every poll.
    if (problem?.kind === 'rejected') return null;
    if (forceRefresh || tokens.expiresAt - now() < 60_000) {
      try {
        await refresh();
      } catch (err) {
        if (err instanceof TokenError && err.code === 'invalid_grant') {
          // The refresh token was revoked or has aged out: unrecoverable without a new sign-in.
          setProblem('login-expired', MSG_EXPIRED);
          await saveTokens(null);
          state.update({ status: 'needs-auth', playing: false, error: MSG_EXPIRED });
          return null;
        }
        if (err instanceof TokenError && err.code === 'invalid_client') {
          setProblem('rejected', MSG_REJECTED);
          state.update({ status: 'needs-auth', playing: false, error: MSG_REJECTED });
          return null;
        }
        // A network blip or a Spotify 5xx is not a reason to throw the sign-in away.
        throw err;
      }
    }
    return tokens?.accessToken ?? null;
  }

  async function noteRateLimit(res: Response) {
    const retryMs = Math.min(Number(res.headers.get('retry-after')) || 5, MAX_RETRY_AFTER_S) * 1000;
    if (/quota/i.test(await readApiMessage(res))) {
      backoffUntil = now() + Math.max(retryMs, QUOTA_BACKOFF_MS);
      state.update({ status: 'error', error: MSG_QUOTA });
    } else {
      backoffUntil = now() + retryMs;
    }
  }

  /** A 403 whose message mentions the permission scope means the sign-in lacks something: say so in Settings. */
  async function noteForbidden(res: Response) {
    if (!problem && /scope/i.test(await readApiMessage(res))) setProblem('permissions', MSG_PERMISSIONS);
  }

  async function api(method: string, path: string, body?: unknown): Promise<Response | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(attempt === 1);
      if (!token) return null;
      const res = await f(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 429) await noteRateLimit(res);
      else if (res.status === 403) await noteForbidden(res);
      return res;
    }
    return null;
  }

  function setError(message: string) {
    state.update({ status: 'error', error: message, playing: false });
  }

  /** Spotify's 403 is generic ("re-authenticating won't help"), so the wording comes from its own message. */
  async function forbiddenText(res: Response): Promise<string> {
    const msg = await readApiMessage(res);
    if (/scope/i.test(msg)) return MSG_PERMISSIONS;
    if (/premium/i.test(msg)) return 'Spotify Premium is required to control playback';
    return msg ? `Spotify refused the request (403): ${msg}` : 'Spotify refused the request (403)';
  }

  async function poll() {
    if (now() < backoffUntil) return;
    try {
      const res = await api('GET', '/me/player?additional_types=track,episode');
      if (!res) {
        state.update({ status: 'needs-auth', playing: false, error: signInMessage() });
        return;
      }
      if (res.status === 204) {
        state.update({ status: 'no-device', playing: false, error: undefined, progressTs: now() });
        return;
      }
      if (!res.ok) {
        if (res.status !== 429) setError(res.status === 403 ? await forbiddenText(res) : `Spotify error ${res.status}`);
        return;
      }
      const j = (await res.json()) as any;
      const track = j.currently_playing_type === 'ad' ? AD_TRACK : (parseTrack(j.item) ?? state.get().track);
      state.set({
        provider: 'spotify',
        status: 'ready',
        playing: Boolean(j.is_playing),
        track,
        progressMs: j.progress_ms ?? 0,
        progressTs: now(),
        volume: j.device?.volume_percent ?? state.get().volume,
        shuffle: Boolean(j.shuffle_state),
        repeat: (['off', 'track', 'context'].includes(j.repeat_state) ? j.repeat_state : 'off') as RepeatMode,
        deviceName: j.device?.name,
        liked: state.get().track?.id === track?.id ? state.get().liked : undefined,
      });
      void refreshLiked();
    } catch (err) {
      setError(err instanceof TokenError ? err.message : `Can't reach Spotify (${(err as Error).message})`);
    }
  }

  function schedule(ms = config.pollMs) {
    if (!running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await poll();
      schedule();
    }, Math.max(ms, backoffUntil - now(), 250));
    timer.unref();
  }

  /** Find our own Connect device (raspotify) so playback can start from idle. */
  async function findDeviceId(): Promise<string | null> {
    const res = await api('GET', '/me/player/devices');
    if (!res?.ok) return null;
    const j = (await res.json()) as any;
    const want = config.deviceName.toLowerCase();
    const dev = (j.devices ?? []).find((d: any) => String(d.name).toLowerCase() === want);
    return dev?.id ?? null;
  }

  async function send(method: string, path: string, body?: unknown, retryOnNoDevice = true): Promise<void> {
    const res = await api(method, path, body);
    if (!res) return;
    if (res.status === 404 && retryOnNoDevice) {
      // "No active device": wake our own device, then retry once.
      const id = await findDeviceId();
      if (id) {
        await api('PUT', '/me/player', { device_ids: [id], play: false });
        await new Promise((r) => setTimeout(r, 500));
        return send(method, path, body, false);
      }
      state.update({ status: 'no-device', error: `Start Spotify on "${config.deviceName}" first` });
      return;
    }
    if (res.status === 403) {
      setError(await forbiddenText(res));
      return;
    }
    if (!res.ok && res.status !== 429) setError(`Spotify error ${res.status}`);
  }

  async function command(c: MediaCommand) {
    const s = state.get();
    // Optimistic update so the UI feels instant; the follow-up poll corrects it.
    switch (c.cmd) {
      case 'play':
      case 'pause':
      case 'toggle': {
        const play = c.cmd === 'play' || (c.cmd === 'toggle' && !s.playing);
        state.update({ playing: play, progressMs: s.progressMs + (s.playing ? now() - s.progressTs : 0), progressTs: now() });
        await send('PUT', play ? '/me/player/play' : '/me/player/pause');
        break;
      }
      case 'next':
        await send('POST', '/me/player/next');
        break;
      case 'prev':
        await send('POST', '/me/player/previous');
        break;
      case 'seek':
        state.update({ progressMs: c.positionMs, progressTs: now() });
        await send('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(c.positionMs))}`);
        break;
      case 'volume': {
        const v = Math.max(0, Math.min(100, Math.round(c.volume)));
        state.update({ volume: v });
        await send('PUT', `/me/player/volume?volume_percent=${v}`);
        break;
      }
      case 'shuffle': {
        state.update({ shuffle: c.enabled });
        // Registered before the first await so a play command that arrives right behind it sees it.
        const request = send('PUT', `/me/player/shuffle?state=${c.enabled}`);
        ordering = request.catch(() => undefined);
        await request;
        break;
      }
      case 'repeat': {
        state.update({ repeat: c.mode });
        const request = send('PUT', `/me/player/repeat?state=${c.mode}`);
        ordering = request.catch(() => undefined);
        await request;
        break;
      }
      case 'playContext': {
        await ordering; // "Shuffle" sends shuffle, then play: Spotify gives no ordering guarantee between player calls
        const id = state.get().status === 'no-device' ? await findDeviceId() : null;
        await send('PUT', `/me/player/play${id ? `?device_id=${encodeURIComponent(id)}` : ''}`, {
          context_uri: c.uri,
          ...(c.offset !== undefined ? { offset: { position: c.offset } } : {}),
        });
        break;
      }
      case 'playTracks': {
        await ordering;
        const id = state.get().status === 'no-device' ? await findDeviceId() : null;
        await send('PUT', `/me/player/play${id ? `?device_id=${encodeURIComponent(id)}` : ''}`, {
          uris: c.uris.slice(0, 100), // kept at 100 (the spec states no maximum; larger lists are untested)
          ...(c.offset !== undefined ? { offset: { position: c.offset } } : {}),
        });
        break;
      }
      case 'queueAdd':
        await ordering;
        await send('POST', `/me/player/queue?uri=${encodeURIComponent(c.uri)}`);
        break;
    }
    schedule(600);
  }

  /** Why a sign-in attempt failed, in words for the user. May record a "rejected" problem. */
  function loginFailure(err: unknown): Error {
    if (err instanceof TokenError) {
      if (err.code === 'invalid_client') {
        setProblem('rejected', MSG_REJECTED);
        return new Error(MSG_REJECTED);
      }
      if (err.code === 'invalid_grant') {
        return new Error(
          "Spotify didn't accept the sign-in code — it may have expired or been used already, or the Redirect URI saved in your Spotify app doesn't match the one shown here. Start the sign-in again.",
        );
      }
      if (err.status >= 500) return new Error('Spotify had a problem answering — try again in a moment.');
      return new Error(`Spotify didn't accept the sign-in (${err.code ?? err.status}). Start the sign-in again.`);
    }
    return new Error(spotifyNetworkFailure(err));
  }

  async function finishLogin(code: string, st: string): Promise<void> {
    const p = pending.get(st);
    if (!p || p.expires < now()) throw new Error('Login expired or invalid state — try again');
    if (finishing.has(st)) throw new Error('Sign-in is already being processed — please wait.');
    finishing.add(st);
    try {
      await loadTokens();
      let r: TokenResponse;
      try {
        r = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: p.verifier });
      } catch (err) {
        // A transport failure before an HTTP response may be temporary; keep
        // state/PKCE so reloading the callback can recover without re-approving.
        // An HTTP OAuth rejection is definitive; do not allow replay.
        if (err instanceof TokenError) pending.delete(st);
        throw loginFailure(err);
      }
      pending.delete(st); // Code exchanged; never accept it a second time.
      if (!r.refreshToken) throw new Error("Spotify's answer was incomplete (no long-lived sign-in). Start the sign-in again.");
      await saveTokens({
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiresAt: now() + r.expiresIn * 1000,
        obtainedAt: now(),
        scope: r.scope,
      });
      problem = null;
      backoffUntil = 0;
      await poll();
      schedule();
    } finally {
      finishing.delete(st);
    }
  }

  return {
    state,
    command,
    poll,

    library: {
      ...library,
      async setLiked(uri, on) {
        const liked = await library.setLiked(uri, on);
        const cur = state.get().track;
        if (cur && uri === `spotify:track:${cur.id}`) state.update({ liked });
        return liked;
      },
    },

    beginLogin() {
      const verifier = b64url(randomBytes(64));
      const st = b64url(randomBytes(16));
      for (const [k, v] of pending) if (v.expires < now()) pending.delete(k);
      pending.set(st, { verifier, expires: now() + 10 * 60_000 });
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: SCOPES,
        redirect_uri: config.redirectUri,
        state: st,
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge(verifier),
      });
      return `${AUTH_URL}?${q}`;
    },

    finishLogin,

    async finishLoginFromPaste(text) {
      const { code, state: st } = parsePastedLogin(text, 'Spotify');
      await finishLogin(code, st);
    },

    async logout() {
      await loadTokens();
      pending.clear();
      problem = null;
      await saveTokens(null);
      state.update({ status: 'needs-auth', playing: false, track: null, error: undefined });
    },

    async spotifyPlayerCredentials() {
      await loadTokens();
      const token = await accessToken();
      if (!token || !tokens) throw new Error('Sign in to Spotify first.');
      const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
      if (!scopes.includes('streaming')) {
        throw new Error('Spotify local playback needs one new permission. Sign out of Spotify in Settings, then sign in again once.');
      }
      return { accessToken: token, expiresAt: tokens.expiresAt, scopes };
    },

    connection(): ServiceAuthInfo {
      const connected = tokens !== null && problem?.kind !== 'login-expired' && problem?.kind !== 'rejected';
      const t = connected ? tokens : null;
      const granted = t?.scope ? t.scope.split(/\s+/).filter(Boolean) : [];
      return {
        connected,
        loginPending: [...pending.values()].some((p) => p.expires >= now()),
        ...(problem ? { problem: problem.kind, message: problem.message } : {}),
        ...(t?.obtainedAt !== undefined ? { connectedAt: t.obtainedAt, loginExpiresAt: t.obtainedAt + LOGIN_LIFETIME_MS } : {}),
        ...(granted.length ? { scopes: granted } : {}),
      };
    },

    async test(): Promise<TestConnectionResult> {
      try {
        const res = await api('GET', '/me/player/devices');
        if (!res) return { ok: false, message: signInMessage() ?? 'Not signed in yet' };
        if (res.ok) {
          const n = ((await res.json()) as any)?.devices?.length ?? 0;
          return { ok: true, message: n === 0 ? 'Spotify answered — no playback devices are online right now' : `Spotify answered — ${n} playback ${n === 1 ? 'device' : 'devices'} found` };
        }
        if (res.status === 401) return { ok: false, message: 'Spotify rejected the saved sign-in — sign in again' };
        if (res.status === 429) {
          const quota = /quota/i.test(await readApiMessage(res));
          return { ok: false, message: quota ? MSG_QUOTA : 'Spotify is rate limiting this app — try again in a moment' };
        }
        if (res.status === 403) {
          const msg = await readApiMessage(res);
          return { ok: false, message: msg ? `Spotify refused the request (403): ${msg}` : 'Spotify refused the request (403)' };
        }
        return { ok: false, message: `Spotify answered with an error (${res.status})` };
      } catch (err) {
        if (err instanceof TokenError && err.status >= 500) return { ok: false, message: 'Spotify had a problem answering — try again in a moment' };
        return { ok: false, message: MSG_OFFLINE };
      }
    },

    start() {
      if (running) return;
      running = true;
      void poll().then(() => schedule());
    },

    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
