import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { JsonStore } from '../store';
import { importBundledMusicCredentials } from './provision';

const dirs: string[] = [];
const id1 = '0123456789abcdef0123456789abcdef';
const tid1 = 'Valid_TIDAL_123';
const secret = 'example-secret-from-owner-12345';
const redirectUri = 'http://127.0.0.1:8787/auth/spotify/callback';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'headunit-provision-'));
  dirs.push(root);
  const data = join(root, 'data');
  const file = join(root, 'private/music-services.json');
  await mkdir(join(root, 'private'));
  await writeFile(file, JSON.stringify({ spotify: { clientId: id1, redirectUri }, tidal: { clientId: tid1, clientSecret: secret } }), { mode: 0o600 });
  return { root, file, data, store: new JsonStore(data) };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('one-time private developer credential provisioning', () => {
  it('imports through the server store, keeps other saved values, and deletes plaintext staging', async () => {
    const f = await fixture();
    await f.store.write('credentials.json', { spotify: { clientId: id1 }, tidal: { scopes: 'user.read' } });
    expect(await importBundledMusicCredentials(f.store, f.root, f.data)).toBe(true);
    const credentials = JSON.parse(await readFile(join(f.data, 'credentials.json'), 'utf8'));
    expect(credentials).toMatchObject({ spotify: { clientId: id1 }, tidal: { clientId: tid1, clientSecret: secret, scopes: 'user.read' } });
    expect(credentials.spotify.redirectUri).toBeUndefined();
    await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await importBundledMusicCredentials(f.store, f.root, f.data)).toBe(false);
    expect((await stat(join(f.data, 'credentials.json'))).mode & 0o077).toBe(0);
  });
  it('rejects an invalid value without replacing previously saved credentials or deleting the file', async () => {
    const f = await fixture();
    await f.store.write('credentials.json', { spotify: { clientId: id1 } });
    await writeFile(f.file, JSON.stringify({ spotify: { clientId: 'wrong', redirectUri }, tidal: { clientId: tid1, clientSecret: secret } }));
    await expect(importBundledMusicCredentials(f.store, f.root, f.data)).rejects.toThrow(/Invalid private music-service/);
    expect(await f.store.read('credentials.json')).toEqual({ spotify: { clientId: id1 } });
    expect((await stat(f.file)).isFile()).toBe(true);
  });
  it('keeps existing service IDs, redirects, and tokens unchanged', async () => {
    const f = await fixture();
    const prior = { spotify: { clientId: 'abcdef0123456789abcdef0123456789', redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback' }, tidal: { clientId: 'Earlier-TIDAL', clientSecret: 'private-existing-value' } };
    await f.store.write('credentials.json', prior);
    await writeFile(join(f.data, 'spotify.json'), '{"old":"spotify"}');
    await writeFile(join(f.data, 'tidal.json'), '{"old":"tidal"}');
    expect(await importBundledMusicCredentials(f.store, f.root, f.data)).toBe(true);
    expect(await f.store.read('credentials.json')).toEqual(prior);
    expect(await readFile(join(f.data, 'spotify.json'), 'utf8')).toBe('{"old":"spotify"}');
    expect(await readFile(join(f.data, 'tidal.json'), 'utf8')).toBe('{"old":"tidal"}');
  });
  it('with "replace": true puts the owner\'s values over saved and .env ones, and signs out only a changed Client ID', async () => {
    const f = await fixture();
    const tidalUri = 'http://127.0.0.1:8787/auth/tidal/callback';
    await writeFile(f.file, JSON.stringify({ replace: true, spotify: { clientId: id1, redirectUri }, tidal: { clientId: tid1, clientSecret: secret, redirectUri: tidalUri } }));
    await f.store.write('credentials.json', {
      spotify: { clientId: 'abcdef0123456789abcdef0123456789', redirectUri: 'http://127.0.0.1:5173/auth/spotify/callback' },
      tidal: { clientId: 'Earlier-TIDAL', clientSecret: 'private-existing-value', scopes: 'user.read playback collection.read' },
    });
    await writeFile(join(f.data, 'spotify.json'), '{"old":"spotify"}');
    await writeFile(join(f.data, 'tidal.json'), '{"old":"tidal"}');
    const before = process.env.TIDAL_CLIENT_ID;
    process.env.TIDAL_CLIENT_ID = 'Env_TIDAL_id';
    try {
      expect(await importBundledMusicCredentials(f.store, f.root, f.data)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.TIDAL_CLIENT_ID;
      else process.env.TIDAL_CLIENT_ID = before;
    }
    expect(await f.store.read('credentials.json')).toEqual({
      spotify: { clientId: id1, redirectUri },
      tidal: { clientId: tid1, clientSecret: secret, redirectUri: tidalUri, scopes: 'user.read playback collection.read' },
    });
    // Both Client IDs changed: the sign-ins belonged to the old apps.
    expect(await f.store.read('spotify.json')).toBe(null);
    expect(await f.store.read('tidal.json')).toBe(null);
    await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('with "replace": true keeps the sign-in of a Client ID that stays the same', async () => {
    const f = await fixture();
    await writeFile(f.file, JSON.stringify({ replace: true, spotify: { clientId: id1, redirectUri }, tidal: { clientId: tid1, clientSecret: secret } }));
    await f.store.write('credentials.json', { spotify: { clientId: id1 }, tidal: { clientId: tid1, clientSecret: 'an-older-rotated-secret' } });
    await writeFile(join(f.data, 'spotify.json'), '{"old":"spotify"}');
    await writeFile(join(f.data, 'tidal.json'), '{"old":"tidal"}');
    expect(await importBundledMusicCredentials(f.store, f.root, f.data)).toBe(true);
    expect(await f.store.read('credentials.json')).toEqual({ spotify: { clientId: id1, redirectUri }, tidal: { clientId: tid1, clientSecret: secret } });
    expect(await readFile(join(f.data, 'spotify.json'), 'utf8')).toBe('{"old":"spotify"}');
    expect(await readFile(join(f.data, 'tidal.json'), 'utf8')).toBe('{"old":"tidal"}');
  });
  it('refuses a "replace" that is not true or false', async () => {
    const f = await fixture();
    await writeFile(f.file, JSON.stringify({ replace: 'yes', spotify: { clientId: id1, redirectUri }, tidal: { clientId: tid1, clientSecret: secret } }));
    await expect(importBundledMusicCredentials(f.store, f.root, f.data)).rejects.toThrow(/Invalid private music-service/);
    expect((await stat(f.file)).isFile()).toBe(true);
  });
  it('never silently overrides credentials coming from the environment', async () => {
    const f = await fixture();
    const before = process.env.SPOTIFY_CLIENT_ID;
    process.env.SPOTIFY_CLIENT_ID = 'abcdef0123456789abcdef0123456789';
    try {
      await importBundledMusicCredentials(f.store, f.root, f.data);
      const credentials = JSON.parse(await readFile(join(f.data, 'credentials.json'), 'utf8'));
      expect(credentials.spotify).toBeUndefined();
      expect(credentials.tidal.clientId).toBe(tid1);
    } finally {
      if (before === undefined) delete process.env.SPOTIFY_CLIENT_ID;
      else process.env.SPOTIFY_CLIENT_ID = before;
    }
  });
});
