import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceConnection } from '@headunit/shared';
import {
  beginLogin,
  connectBlurb,
  fetchConnections,
  formatDate,
  hintOf,
  pasteLogin,
  pickOpenService,
  providerLabel,
  saveConnection,
  serviceOfProvider,
  setupBlurb,
  shouldPoll,
  signOut,
  statusOf,
  testConnection,
  timeAgo,
  unavailableBlurb,
} from './connections';

const conn = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  service: 'spotify',
  label: 'Spotify',
  available: true,
  configured: true,
  clientId: '0123456789abcdef0123456789abcdef',
  clientIdSource: 'saved',
  dashboardUrl: 'https://developer.spotify.com/dashboard',
  redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback',
  redirectUriSource: 'default',
  connected: false,
  loginPending: false,
  ...over,
});

const unset = (over: Partial<ServiceConnection> = {}) => conn({ configured: false, clientId: '', clientIdSource: 'none', ...over });
/** The real TIDAL: built, and usable on its Client ID + Client Secret alone (sign-in is optional). */
const tidal = (over: Partial<ServiceConnection> = {}) => unset({ service: 'tidal', label: 'TIDAL', ...over });
/** A service this build does not have (`available: false`): the generic "not in this build" path. Neither real service is in this state. */
const notBuilt = (over: Partial<ServiceConnection> = {}) => unset({ available: false, ...over });

describe('statusOf', () => {
  it('covers every state', () => {
    expect(statusOf(unset())).toEqual({ tone: 'idle', label: 'Not set up' });
    expect(statusOf(conn())).toEqual({ tone: 'idle', label: 'Ready to sign in' });
    expect(statusOf(conn({ loginPending: true }))).toEqual({ tone: 'warn', label: 'Signing in…' });
    expect(statusOf(conn({ connected: true }))).toEqual({ tone: 'ok', label: 'Connected' });
    expect(statusOf(conn({ problem: 'login-expired' }))).toEqual({ tone: 'warn', label: 'Sign-in expired' });
    expect(statusOf(conn({ connected: true, problem: 'permissions' }))).toEqual({ tone: 'warn', label: 'Needs permissions' });
    expect(statusOf(conn({ problem: 'rejected' }))).toEqual({ tone: 'bad', label: 'Rejected by service' });
  });

  it('says so when the service is not in this build, even with a Client ID saved', () => {
    expect(statusOf(notBuilt())).toEqual({ tone: 'idle', label: 'Not available yet' });
    expect(statusOf(conn({ available: false }))).toEqual({ tone: 'idle', label: 'Not available yet' });
  });

  it('TIDAL is a real, available service: set up, then "Catalog ready" without any sign-in, then Connected', () => {
    expect(statusOf(tidal())).toEqual({ tone: 'idle', label: 'Not set up' });
    expect(statusOf(tidal({ configured: true, clientId: 'abc_123-xyz' }))).toEqual({ tone: 'ok', label: 'Catalog ready' });
    expect(statusOf(tidal({ configured: true, clientId: 'abc_123-xyz', connected: true }))).toEqual({ tone: 'ok', label: 'Connected' });
  });

  it('shows a sign-in in progress ahead of an old problem', () => {
    expect(statusOf(conn({ problem: 'login-expired', loginPending: true })).label).toBe('Signing in…');
  });
});

describe('pickOpenService', () => {
  const ready = (over: Partial<ServiceConnection> = {}) => tidal({ configured: true, clientId: 'abc_123-xyz', clientIdSource: 'saved', ...over });

  it('opens the first service with something to fix or finish', () => {
    expect(pickOpenService([conn({ problem: 'login-expired' }), tidal()])).toBe('spotify');
    expect(pickOpenService([conn(), tidal()])).toBe('spotify'); // Client ID saved, not signed in yet
    expect(pickOpenService([conn({ connected: true }), ready({ problem: 'login-expired' })])).toBe('tidal'); // a broken TIDAL sign-in is worth a look
  });

  it('does not nag about TIDAL: Client ID + Secret saved and no sign-in is a finished setup (the sign-in is optional)', () => {
    expect(pickOpenService([conn({ connected: true }), ready()])).toBeNull();
    expect(pickOpenService([conn(), ready()])).toBe('spotify'); // Spotify still has to be signed in
    expect(pickOpenService([unset({ available: false }), ready()])).toBeNull(); // nothing connected, but TIDAL is usable as it is
  });

  it('opens the first available service on a fresh install', () => {
    expect(pickOpenService([unset(), tidal()])).toBe('spotify');
    expect(pickOpenService([notBuilt(), tidal()])).toBe('tidal');
  });

  it('leaves everything folded when all is well or nothing can be done', () => {
    expect(pickOpenService([conn({ connected: true }), tidal()])).toBeNull();
    expect(pickOpenService([notBuilt(), notBuilt({ service: 'tidal', label: 'TIDAL' })])).toBeNull();
    expect(pickOpenService([])).toBeNull();
  });

  it('never opens a service this build does not have, whatever its state', () => {
    expect(pickOpenService([notBuilt({ problem: 'login-expired' }), conn({ connected: true })])).toBeNull();
    expect(pickOpenService([conn({ service: 'tidal', label: 'TIDAL', available: false, configured: true })])).toBeNull();
  });
});

describe('wording helpers', () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);
  const ago = (ms: number) => timeAgo(now - ms, now);
  const MIN = 60_000;
  const DAY = 86_400_000;

  it('timeAgo is plain and singular-aware', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(-5_000)).toBe('just now'); // clock skew
    expect(ago(MIN)).toBe('1 minute ago');
    expect(ago(5 * MIN)).toBe('5 minutes ago');
    expect(ago(60 * MIN)).toBe('1 hour ago');
    expect(ago(23 * 60 * MIN)).toBe('23 hours ago');
    expect(ago(DAY)).toBe('1 day ago');
    expect(ago(3 * DAY)).toBe('3 days ago');
    expect(ago(60 * DAY)).toBe('2 months ago');
  });

  it('formatDate uses the given locale', () => {
    expect(formatDate(Date.UTC(2026, 10, 5, 12), 'en-GB')).toBe('5 Nov 2026');
  });

  it('hintOf gives the one-line summary for each state', () => {
    expect(hintOf(unset(), now)).toBe('Add your Client ID to get started');
    expect(hintOf(conn(), now)).toContain('sign in');
    expect(hintOf(conn({ loginPending: true }), now)).toContain('Waiting');
    expect(hintOf(conn({ connected: true, connectedAt: now - 3 * DAY }), now)).toBe('Signed in 3 days ago');
    expect(hintOf(conn({ connected: true }), now)).toBe('Signed in');
    expect(hintOf(conn({ problem: 'login-expired' }), now)).toContain('Sign in again');
    expect(hintOf(conn({ problem: 'rejected' }), now)).toContain('Redirect URI');
    expect(hintOf(notBuilt(), now)).toBe('Sign-in for Spotify is not part of this version yet');
  });

  it('hintOf speaks TIDAL: Client ID + Client Secret, and an optional sign-in', () => {
    expect(hintOf(tidal(), now)).toBe('Add your Client ID + Client Secret to get started');
    expect(hintOf(tidal({ configured: true, clientId: 'abc_123-xyz' }), now)).toBe('Catalog API ready — account sign-in optional');
  });

  it('the set-up prompt is TIDAL-specific: both credentials, nothing promised from a sign-in', () => {
    const t = setupBlurb('tidal');
    expect(t).toContain('Client ID and Client Secret');
    expect(t).toContain('optional');
    expect(t).not.toMatch(/then sign in|library|playlists|now-playing/i);
    expect(setupBlurb('spotify')).toBe('Add your Spotify Client ID once, then sign in. It takes a couple of minutes and you only do it once.');
  });

  it('the connect prompt does not promise a TIDAL library, and keeps the Premium note for Spotify only', () => {
    expect(connectBlurb('tidal')).toContain('work without signing in');
    expect(connectBlurb('tidal')).not.toMatch(/library|playlists|now-playing|Premium/);
    expect(connectBlurb('spotify')).toContain('your library, playlists and now-playing appear here');
    expect(connectBlurb('spotify')).toContain('Spotify Premium is required');
  });

  it('the unavailable prompt names the missing service and points at Settings', () => {
    expect(unavailableBlurb('Future Music')).toBe('This version of the head unit was built without Future Music. You can pick a different music source in Settings.');
  });

  it('names the active provider', () => {
    expect(providerLabel('spotify')).toBe('Spotify');
    expect(providerLabel('tidal')).toBe('TIDAL');
    expect(providerLabel(undefined)).toBe('Music service');
    expect(serviceOfProvider('tidal')).toBe('tidal');
    expect(serviceOfProvider(undefined)).toBeNull();
  });

  it('polls only while a sign-in is waiting', () => {
    expect(shouldPoll(null)).toBe(false);
    expect(shouldPoll([conn(), conn({ service: 'tidal' })])).toBe(false);
    expect(shouldPoll([conn(), conn({ service: 'tidal', loginPending: true })])).toBe(true);
  });
});

describe('API wrappers', () => {
  const reply = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const stub = (r: Response | Error) => {
    const fn = vi.fn(async () => {
      if (r instanceof Error) throw r;
      return r.clone();
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const lastCall = (fn: ReturnType<typeof stub>) => {
    const [path, init] = fn.mock.calls[0] as unknown as [string, RequestInit | undefined];
    return { path, init };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('fetchConnections reads GET /api/connections', async () => {
    const fn = stub(reply(200, { services: [conn(), conn({ service: 'tidal' })] }));
    const list = await fetchConnections();
    expect(list.map((s) => s.service)).toEqual(['spotify', 'tidal']);
    expect(lastCall(fn)).toEqual({ path: '/api/connections', init: { method: 'GET' } });
  });

  it('saveConnection PUTs the request as JSON', async () => {
    const saved = conn({ connected: false });
    const fn = stub(reply(200, saved));
    const out = await saveConnection('spotify', { clientId: 'abc', redirectUri: null });
    expect(out).toEqual(saved);
    const { path, init } = lastCall(fn);
    expect(path).toBe('/api/connections/spotify');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({ clientId: 'abc', redirectUri: null });
  });

  it('signOut DELETEs, and forgets with ?forget=1', async () => {
    let fn = stub(reply(200, conn()));
    await signOut('tidal');
    expect(lastCall(fn)).toEqual({ path: '/api/connections/tidal', init: { method: 'DELETE' } });
    fn = stub(reply(200, conn()));
    await signOut('spotify', true);
    expect(lastCall(fn)).toEqual({ path: '/api/connections/spotify?forget=1', init: { method: 'DELETE' } });
  });

  it('beginLogin returns the authorize address', async () => {
    const fn = stub(reply(200, { url: 'https://accounts.spotify.com/authorize?x=1' }));
    expect(await beginLogin('spotify')).toBe('https://accounts.spotify.com/authorize?x=1');
    expect(lastCall(fn)).toEqual({ path: '/api/connections/spotify/login', init: { method: 'POST' } });
  });

  it('beginLogin refuses an answer without an address', async () => {
    stub(reply(200, {}));
    await expect(beginLogin('spotify')).rejects.toThrow(/did not return a sign-in address/);
    stub(reply(200, { url: '' }));
    await expect(beginLogin('spotify')).rejects.toThrow(/did not return a sign-in address/);
  });

  it('pasteLogin sends the trimmed text, and does not call the server for an empty box', async () => {
    const fn = stub(reply(200, conn({ connected: true })));
    const out = await pasteLogin('spotify', '  http://127.0.0.1:8787/auth/spotify/callback?code=c&state=s \n');
    expect(out.connected).toBe(true);
    const { path, init } = lastCall(fn);
    expect(path).toBe('/api/connections/spotify/paste');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'http://127.0.0.1:8787/auth/spotify/callback?code=c&state=s' });

    const none = stub(reply(200, conn()));
    await expect(pasteLogin('spotify', '   ')).rejects.toThrow('Paste the address from your phone first.');
    expect(none).not.toHaveBeenCalled();
  });

  it('testConnection returns the result', async () => {
    const fn = stub(reply(200, { ok: true, message: 'Reached Spotify.' }));
    expect(await testConnection('spotify')).toEqual({ ok: true, message: 'Reached Spotify.' });
    expect(lastCall(fn).path).toBe('/api/connections/spotify/test');
  });

  it('surfaces the server’s {error} message as the thrown Error', async () => {
    stub(reply(400, { error: 'That Client ID looks wrong.' }));
    await expect(saveConnection('spotify', { clientId: 'x' })).rejects.toThrow('That Client ID looks wrong.');
    stub(reply(409, { error: 'No sign-in is waiting.' }));
    await expect(pasteLogin('spotify', 'http://x')).rejects.toThrow('No sign-in is waiting.');
    stub(reply(502, { error: 'Spotify did not answer.' }));
    await expect(testConnection('spotify')).rejects.toThrow('Spotify did not answer.');
  });

  it('falls back to a generic message when the error body is not JSON or has no message', async () => {
    stub(reply(500, 'Internal Server Error'));
    await expect(fetchConnections()).rejects.toThrow('Error 500');
    stub(reply(404, { error: '' }));
    await expect(fetchConnections()).rejects.toThrow('Error 404');
  });

  it('turns a network failure into a plain message', async () => {
    stub(new TypeError('fetch failed'));
    await expect(fetchConnections()).rejects.toThrow('Can’t reach the head unit');
  });
});
