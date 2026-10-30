import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultRedirectUri, validateClientId, validateClientSecret, validateRedirectUri, validateScopes } from '@headunit/shared';
import { JsonStore } from '../store';
import { loadCredentials, resolveService, sanitizeCredentials, saveServiceCredentials } from './credentials';
import { parsePastedLogin } from './paste';

const SPOTIFY_ID = '0123456789abcdef0123456789abcdef';
const TIDAL_SECRET = 'tidal-secret-0123456789';
const TIDAL_SECRET_2 = 'tidal-secret-abcdefghij';

describe('validateClientId', () => {
  it('accepts a Spotify id, lowercases it, strips quotes and spaces', () => {
    expect(validateClientId('spotify', `  "${SPOTIFY_ID.toUpperCase()}" `)).toEqual({ ok: true, value: SPOTIFY_ID });
  });
  it('rejects wrong length / characters and never echoes the input', () => {
    for (const bad of ['', '   ', 'abc', 'g'.repeat(32), SPOTIFY_ID + '0', 12, null, undefined]) {
      const r = validateClientId('spotify', bad);
      expect(r.ok).toBe(false);
      if (!r.ok && typeof bad === 'string' && bad.length > 3) expect(r.error).not.toContain(bad);
    }
  });
  it('TIDAL ids are a looser sanity check', () => {
    expect(validateClientId('tidal', 'Ab_c-123XYZ').ok).toBe(true);
    expect(validateClientId('tidal', 'has space').ok).toBe(false);
    expect(validateClientId('tidal', 'x'.repeat(300)).ok).toBe(false);
  });
});

describe('validateClientSecret', () => {
  const SECRET = 'tidal-secret-0123456789';
  it('accepts an opaque printable TIDAL secret, trims it and strips quotes', () => {
    expect(validateClientSecret('tidal', SECRET)).toEqual({ ok: true, value: SECRET });
    expect(validateClientSecret('tidal', `  "${SECRET}" `)).toEqual({ ok: true, value: SECRET });
    expect(validateClientSecret('tidal', 'Ab+/=_-.~0123456789').ok).toBe(true); // opaque: any printable, non-space characters
  });
  it('rejects the wrong kind of value and never echoes the input', () => {
    for (const bad of ['', '   ', 'tiny', 'has a space inside', 'tab\tinside-secret', 'x'.repeat(513), 'secret-\u00e9\u00e9\u00e9\u00e9\u00e9', 'line\nbreak-secret', 42, null, undefined, {}]) {
      const r = validateClientSecret('tidal', bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok && typeof bad === 'string' && bad.trim().length > 4) expect(r.error).not.toContain(bad.trim());
    }
  });
  it('Spotify has no Client Secret here', () => {
    expect(validateClientSecret('spotify', SECRET)).toEqual({ ok: false, error: 'This service does not use a Client Secret here.' });
  });
});

describe('validateRedirectUri', () => {
  it('Spotify: https or http on a loopback IP literal only', () => {
    expect(validateRedirectUri('spotify', 'http://127.0.0.1:8787/auth/spotify/callback').ok).toBe(true);
    expect(validateRedirectUri('spotify', 'https://car.example.com/cb').ok).toBe(true);
    expect(validateRedirectUri('spotify', 'http://localhost:8787/cb').ok).toBe(false);
    expect(validateRedirectUri('spotify', 'http://192.168.1.5/cb').ok).toBe(false);
  });
  it('rejects junk, credentials in the URL, fragments and other schemes', () => {
    for (const bad of ['', 'not a url', 'ftp://x.example/cb', 'https://u:p@x.example/cb', 'https://x.example/cb#frag', 'javascript:alert(1)', 'x'.repeat(400)]) {
      expect(validateRedirectUri('tidal', bad).ok).toBe(false);
    }
  });
  it('default redirect uses the port', () => {
    expect(defaultRedirectUri('spotify', 8787)).toBe('http://127.0.0.1:8787/auth/spotify/callback');
    expect(defaultRedirectUri('tidal', 9000)).toBe('http://127.0.0.1:9000/auth/tidal/callback');
  });
});

describe('validateScopes', () => {
  it('normalises separators and rejects odd characters', () => {
    expect(validateScopes('a.read,  b.write\nc')).toEqual({ ok: true, value: 'a.read b.write c' });
    expect(validateScopes('')).toEqual({ ok: true, value: '' });
    expect(validateScopes('ok bad;rm').ok).toBe(false);
  });
});

describe('parsePastedLogin', () => {
  const full = 'http://127.0.0.1:8787/auth/spotify/callback?code=AQD-xyz_123&state=abcDEF';
  it('reads a full redirect address, a bare query string and a code/state pair', () => {
    expect(parsePastedLogin(full, 'Spotify')).toEqual({ code: 'AQD-xyz_123', state: 'abcDEF' });
    expect(parsePastedLogin('?code=c1&state=s1', 'Spotify')).toEqual({ code: 'c1', state: 's1' });
    expect(parsePastedLogin('code=c2&state=s2', 'Spotify')).toEqual({ code: 'c2', state: 's2' });
  });
  it('survives wrapped lines, quotes, angle brackets and a #fragment', () => {
    expect(parsePastedLogin(`  <"${full.slice(0, 40)}\n${full.slice(40)}">  `, 'Spotify')).toEqual({ code: 'AQD-xyz_123', state: 'abcDEF' });
    expect(parsePastedLogin(`${full}#_=_`, 'Spotify').code).toBe('AQD-xyz_123');
  });
  it('explains an error redirect and a wrong paste, and never echoes the pasted text', () => {
    expect(() => parsePastedLogin('http://127.0.0.1:8787/cb?error=access_denied&state=s', 'Spotify')).toThrow(/Spotify said: access_denied/);
    expect(() => parsePastedLogin('https://accounts.spotify.com/authorize?client_id=SECRETISH', 'Spotify')).toThrow(/code=/);
    try {
      parsePastedLogin('hello SECRETISH world', 'Spotify');
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETISH');
    }
    expect(() => parsePastedLogin('', 'Spotify')).toThrow();
    expect(() => parsePastedLogin(undefined, 'Spotify')).toThrow();
    expect(() => parsePastedLogin('a'.repeat(5000), 'Spotify')).toThrow(/too long/);
  });
});

describe('credentials store', () => {
  const tmp = () => mkdtemp(join(tmpdir(), 'hu-cred-'));

  it('saves, reloads, edits and clears per service; writes the file private', async () => {
    const dir = await tmp();
    const store = new JsonStore(dir);
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID.toUpperCase() });
    await saveServiceCredentials(store, 'tidal', { clientId: 'tidalId123', scopes: 'a.read b.read' });
    expect(await loadCredentials(store)).toEqual({ spotify: { clientId: SPOTIFY_ID }, tidal: { clientId: 'tidalId123', scopes: 'a.read b.read' } });
    expect((await stat(join(dir, 'credentials.json'))).mode & 0o777).toBe(0o600);
    await saveServiceCredentials(store, 'tidal', { scopes: null });
    await saveServiceCredentials(store, 'spotify', { clientId: null });
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: 'tidalId123' } });
    await saveServiceCredentials(store, 'tidal', { clientId: '' });
    expect(JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'))).toEqual({});
  });

  it('rejects bad input without writing anything', async () => {
    const store = new JsonStore(await tmp());
    await expect(saveServiceCredentials(store, 'spotify', { clientId: 'nope' })).rejects.toThrow(/Spotify Client ID/);
    await expect(saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID, redirectUri: 'http://localhost/cb' })).rejects.toThrow(/127\.0\.0\.1/);
    expect(await loadCredentials(store)).toEqual({});
  });

  it('keeps the TIDAL Client Secret next to the Client ID (file 0600); null or an empty string removes it; undefined leaves it', async () => {
    const dir = await tmp();
    const store = new JsonStore(dir);
    await saveServiceCredentials(store, 'tidal', { clientId: 'tidalId123', clientSecret: ` "${TIDAL_SECRET}" ` });
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: 'tidalId123', clientSecret: TIDAL_SECRET } });
    expect((await stat(join(dir, 'credentials.json'))).mode & 0o777).toBe(0o600);
    await saveServiceCredentials(store, 'tidal', { scopes: 'a.read' }); // the secret is untouched
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: 'tidalId123', clientSecret: TIDAL_SECRET, scopes: 'a.read' } });
    await saveServiceCredentials(store, 'tidal', { clientSecret: null });
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: 'tidalId123', scopes: 'a.read' } });
    await saveServiceCredentials(store, 'tidal', { clientSecret: TIDAL_SECRET });
    await saveServiceCredentials(store, 'tidal', { clientSecret: '' });
    expect((await loadCredentials(store)).tidal?.clientSecret).toBeUndefined();
    // Forgetting everything leaves nothing behind in the file.
    await saveServiceCredentials(store, 'tidal', { clientSecret: TIDAL_SECRET });
    await saveServiceCredentials(store, 'tidal', { clientId: null, clientSecret: null, redirectUri: null, scopes: null });
    expect(JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'))).toEqual({});
  });

  it('rejects a bad Client Secret, and any secret for Spotify, without writing or echoing it', async () => {
    const dir = await tmp();
    const store = new JsonStore(dir);
    await expect(saveServiceCredentials(store, 'tidal', { clientId: 'tidalId123', clientSecret: 'tiny' })).rejects.toThrow(/too short/);
    await expect(saveServiceCredentials(store, 'tidal', { clientSecret: 'has a space inside' })).rejects.toThrow(/unsupported characters/);
    await expect(saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID, clientSecret: TIDAL_SECRET })).rejects.toThrow('This service does not use a Client Secret here.');
    expect(await loadCredentials(store)).toEqual({});
    await expect(readFile(join(dir, 'credentials.json'), 'utf8')).rejects.toThrow(); // nothing was written
  });

  it('sanitizes a hand-edited or corrupted file', () => {
    expect(sanitizeCredentials(null)).toEqual({});
    expect(sanitizeCredentials([1, 2])).toEqual({});
    expect(sanitizeCredentials({ spotify: { clientId: 'bad', redirectUri: 'ftp://x' }, tidal: 7, evil: { clientId: SPOTIFY_ID } })).toEqual({});
    expect(sanitizeCredentials({ spotify: { clientId: SPOTIFY_ID, extra: 'x' } })).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('sanitizes the TIDAL Client Secret: kept when valid, dropped when invalid, never kept for Spotify', () => {
    expect(sanitizeCredentials({ tidal: { clientId: 'tidalId123', clientSecret: TIDAL_SECRET } })).toEqual({ tidal: { clientId: 'tidalId123', clientSecret: TIDAL_SECRET } });
    expect(sanitizeCredentials({ tidal: { clientId: 'tidalId123', clientSecret: 'has a space inside' } })).toEqual({ tidal: { clientId: 'tidalId123' } });
    expect(sanitizeCredentials({ tidal: { clientSecret: 7 } })).toEqual({});
    expect(sanitizeCredentials({ spotify: { clientId: SPOTIFY_ID, clientSecret: TIDAL_SECRET } })).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('resolves saved > environment > default, and ignores invalid environment values', () => {
    const saved = { spotify: { clientId: SPOTIFY_ID } };
    const envId = 'fedcba9876543210fedcba9876543210';
    expect(resolveService('spotify', saved, { clientId: envId }, 8787)).toMatchObject({ clientId: SPOTIFY_ID, clientIdSource: 'saved', redirectUriSource: 'default', redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback' });
    expect(resolveService('spotify', {}, { clientId: envId, redirectUri: 'https://car.example.com/cb' }, 8787)).toMatchObject({ clientId: envId, clientIdSource: 'env', redirectUriSource: 'env', redirectUri: 'https://car.example.com/cb' });
    expect(resolveService('spotify', {}, { clientId: 'garbage', redirectUri: 'ftp://x' }, 8787)).toMatchObject({ clientId: '', clientIdSource: 'none', redirectUriSource: 'default' });
    expect(resolveService('tidal', { tidal: { scopes: 'x.read' } }, { scopes: 'y.read' }, 1, 'd.read').scopes).toBe('x.read');
    expect(resolveService('tidal', {}, { scopes: 'y.read, z.read' }, 1, 'd.read').scopes).toBe('y.read z.read');
    expect(resolveService('tidal', {}, {}, 1, 'd.read').scopes).toBe('d.read');
  });

  it('resolves the TIDAL Client Secret on its own: saved > environment, invalid environment ignored, none for Spotify', () => {
    const id = { clientId: 'tidalId123' };
    expect(resolveService('tidal', { tidal: { ...id, clientSecret: TIDAL_SECRET } }, { clientSecret: TIDAL_SECRET_2 }, 1)).toMatchObject({ clientSecret: TIDAL_SECRET, clientSecretSource: 'saved' });
    expect(resolveService('tidal', { tidal: id }, { clientSecret: TIDAL_SECRET_2 }, 1)).toMatchObject({ clientId: 'tidalId123', clientSecret: TIDAL_SECRET_2, clientSecretSource: 'env' });
    expect(resolveService('tidal', { tidal: id }, { clientSecret: 'has a space' }, 1)).toMatchObject({ clientSecret: '', clientSecretSource: 'none' });
    expect(resolveService('tidal', {}, {}, 1)).toMatchObject({ clientId: '', clientSecret: '', clientSecretSource: 'none' });
    // The secret is resolved independently of the ID: each shows its own source.
    expect(resolveService('tidal', { tidal: { clientSecret: TIDAL_SECRET } }, { clientId: 'envTidalId1' }, 1)).toMatchObject({ clientIdSource: 'env', clientSecretSource: 'saved' });
    expect(resolveService('spotify', { spotify: { clientId: SPOTIFY_ID, clientSecret: TIDAL_SECRET } as never }, { clientSecret: TIDAL_SECRET_2 }, 1)).toMatchObject({ clientSecret: '', clientSecretSource: 'none' });
  });
});
