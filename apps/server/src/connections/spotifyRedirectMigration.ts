import type { JsonStore } from '../store';
import { CREDENTIALS_FILE, loadCredentials } from './credentials';

export const OLD_SPOTIFY_CALLBACK = 'http://127.0.0.1:5173/auth/spotify/callback';
export const SPOTIFY_CALLBACK_8787 = 'http://127.0.0.1:8787/auth/spotify/callback';
const MIGRATION_FILE = 'spotify-redirect-8787-migration.json';

/**
 * One-time migration from the owner's previously configured 5173 redirect.
 * A head-unit software update preserves both .env and data/credentials.json,
 * so simply changing .env.example would leave installed Pi devices on 5173.
 * This intentionally ONLY changes the exact legacy Spotify callback, never
 * third-party callbacks, developer Client IDs, TIDAL credentials or tokens.
 */
export async function migrateSpotifyCallback8787(store: JsonStore, envUri?: string): Promise<boolean> {
  if (await store.read(MIGRATION_FILE)) return false;
  const saved = await loadCredentials(store);
  const savedUri = saved.spotify?.redirectUri;
  if (savedUri !== OLD_SPOTIFY_CALLBACK && !(savedUri === undefined && envUri === OLD_SPOTIFY_CALLBACK)) {
    return false;
  }
  const next = {
    ...saved,
    spotify: { ...saved.spotify, redirectUri: SPOTIFY_CALLBACK_8787 },
  };
  // Persist the new callback BEFORE the marker; any failed write is retryable.
  await store.writeOrThrow(CREDENTIALS_FILE, next);
  await store.writeOrThrow(MIGRATION_FILE, { from: 5173, to: 8787, appliedAt: new Date().toISOString() });
  console.log('[headunit] Migrated legacy Spotify callback from port 5173 to 8787 (saved credentials and tokens preserved).');
  return true;
}
