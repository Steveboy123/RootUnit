import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../store';
import { migrateSpotifyCallback8787, OLD_SPOTIFY_CALLBACK, SPOTIFY_CALLBACK_8787 } from './spotifyRedirectMigration';

const dirs: string[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'spotify-port-migration-'));
  dirs.push(dir);
  return { dir, store: new JsonStore(dir) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('one-time Spotify callback restore to 8787', () => {
  it('migrates only the 5173 saved Spotify URI; preserves IDs, TIDAL, scopes and token files', async () => {
    const { dir, store } = await fixture();
    const original = { spotify: { clientId: '0123456789abcdef0123456789abcdef', redirectUri: OLD_SPOTIFY_CALLBACK, scopes: 'user-read-private' }, tidal: { clientId: 'Existing_Tidal', clientSecret: 'existing-tidal-secret', redirectUri: 'https://example.org/tidal' } };
    await store.writeOrThrow('credentials.json', original);
    await writeFile(join(dir, 'spotify.json'), '{"token":"unchanged"}');
    await writeFile(join(dir, 'tidal.json'), '{"token":"unchanged"}');
    expect(await migrateSpotifyCallback8787(store)).toBe(true);
    expect(await store.read('credentials.json')).toEqual({ ...original, spotify: { ...original.spotify, redirectUri: SPOTIFY_CALLBACK_8787 } });
    expect(await readFile(join(dir, 'spotify.json'), 'utf8')).toBe('{"token":"unchanged"}');
    expect(await readFile(join(dir, 'tidal.json'), 'utf8')).toBe('{"token":"unchanged"}');
    expect(await migrateSpotifyCallback8787(store)).toBe(false);
  });
  it('migrates an old env URI only when no Spotify redirect has been saved', async () => {
    const { store } = await fixture();
    await store.writeOrThrow('credentials.json', { spotify: { clientId: '0123456789abcdef0123456789abcdef' } });
    expect(await migrateSpotifyCallback8787(store, OLD_SPOTIFY_CALLBACK)).toBe(true);
    expect((await store.read('credentials.json') as any).spotify).toEqual({ clientId: '0123456789abcdef0123456789abcdef', redirectUri: SPOTIFY_CALLBACK_8787 });
  });
  it('never overrides a deliberately different saved callback or TIDAL settings', async () => {
    const { store } = await fixture();
    const original = { spotify: { clientId: '0123456789abcdef0123456789abcdef', redirectUri: 'https://car.example.com/spotify' }, tidal: { clientId: 'old', redirectUri: 'https://car.example.com/tidal' } };
    await store.writeOrThrow('credentials.json', original);
    expect(await migrateSpotifyCallback8787(store, OLD_SPOTIFY_CALLBACK)).toBe(false);
    expect(await store.read('credentials.json')).toEqual(original);
    expect(await store.read('spotify-redirect-8787-migration.json')).toBe(null);
  });
  it('does not touch fresh setups without a legacy redirect', async () => {
    const { store } = await fixture();
    expect(await migrateSpotifyCallback8787(store, SPOTIFY_CALLBACK_8787)).toBe(false);
    expect(await store.read('credentials.json')).toBe(null);
  });
});
