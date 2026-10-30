import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateClientId, validateClientSecret, validateRedirectUri } from '@headunit/shared';
import type { JsonStore } from '../store';
import { CREDENTIALS_FILE, loadCredentials } from './credentials';

/**
 * One-time import of owner-supplied developer credentials packaged separately from the UI source.
 * The software updater intentionally preserves data/ and .env, so a standalone .env in an update
 * would never configure an already installed Pi. This server-only import handles that case.
 *
 * Only the fixed, non-web-served private/music-services.json path is accepted. After a successful
 * import, the plaintext provisioning file is removed; credentials stay in data/credentials.json
 * (0600) with the existing settings UI able to change them later.
 *
 * By default only a service with no Client ID at all is filled. `"replace": true` in the file makes the
 * owner's values win over whatever is saved or in .env (once: the file is deleted after the import).
 */
export async function importBundledMusicCredentials(store: JsonStore, projectDir: string, _dataDir: string): Promise<boolean> {
  const file = join(projectDir, 'private', 'music-services.json');
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw err;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) {
    throw new Error('Invalid private music-service provisioning file.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error('Could not read the private music-service provisioning file.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid private music-service provisioning settings.');
  }
  const settings = raw as Record<string, unknown>;
  if (!settings.spotify || !settings.tidal || typeof settings.spotify !== 'object' || typeof settings.tidal !== 'object') {
    throw new Error('Private music-service provisioning is missing a service.');
  }
  if (settings.replace !== undefined && typeof settings.replace !== 'boolean') {
    throw new Error('Invalid private music-service provisioning settings.');
  }
  const replace = settings.replace === true;
  const spotify = settings.spotify as Record<string, unknown>;
  const tidal = settings.tidal as Record<string, unknown>;
  const spotifyId = validateClientId('spotify', spotify.clientId);
  const spotifyUri = validateRedirectUri('spotify', spotify.redirectUri);
  const tidalId = validateClientId('tidal', tidal.clientId);
  const tidalSecret = validateClientSecret('tidal', tidal.clientSecret);
  const tidalUri = tidal.redirectUri === undefined ? null : validateRedirectUri('tidal', tidal.redirectUri);
  if (!spotifyId.ok || !spotifyUri.ok || !tidalId.ok || !tidalSecret.ok || (tidalUri && !tidalUri.ok)) {
    throw new Error('Invalid private music-service credentials. No credentials were imported.');
  }

  const previous = await loadCredentials(store);
  // Without "replace", a bundled ZIP must never replace credentials that already worked on this
  // Pi. Previously this overwrote both saved Client IDs and could delete the
  // corresponding tokens; even a saved redirect was replaced for Spotify.
  // Only provision a genuinely missing service, and do not override .env.
  // With "replace" the owner explicitly asked for these values, e.g. to undo the v2.8.0 import that put
  // other Client IDs on this Pi. Saved values win over .env, so writing them is enough to override both.
  const provisionSpotify = replace || (!previous.spotify?.clientId && !process.env.SPOTIFY_CLIENT_ID?.trim());
  const provisionTidal = replace || (!previous.tidal?.clientId && !process.env.TIDAL_CLIENT_ID?.trim());
  // A sign-in belongs to one Client ID. When a replacement changes it, sign that service out, exactly as
  // changing the Client ID in Settings does; a sign-in for the same Client ID is kept.
  const previousId = (saved: string | undefined, env: string | undefined, service: 'spotify' | 'tidal') => {
    if (saved) return saved;
    const fromEnv = env?.trim() ? validateClientId(service, env) : null;
    return fromEnv?.ok ? fromEnv.value : '';
  };
  const oldSpotifyId = previousId(previous.spotify?.clientId, process.env.SPOTIFY_CLIENT_ID, 'spotify');
  const oldTidalId = previousId(previous.tidal?.clientId, process.env.TIDAL_CLIENT_ID, 'tidal');
  const signOutSpotify = replace && oldSpotifyId !== '' && oldSpotifyId !== spotifyId.value;
  const signOutTidal = replace && oldTidalId !== '' && oldTidalId !== tidalId.value;
  if (provisionSpotify || provisionTidal) {
    const next = { ...previous };
    if (provisionSpotify) next.spotify = { ...next.spotify, clientId: spotifyId.value, redirectUri: spotifyUri.value };
    if (provisionTidal) {
      next.tidal = { ...next.tidal, clientId: tidalId.value, clientSecret: tidalSecret.value };
      if (tidalUri?.ok) next.tidal.redirectUri = tidalUri.value;
    }
    // Throw on disk errors before deleting the source file. A failed write must
    // never silently destroy the only copy of the owner-supplied credentials.
    await store.writeOrThrow(CREDENTIALS_FILE, next);
    if (signOutSpotify) await store.writeOrThrow('spotify.json', null);
    if (signOutTidal) await store.writeOrThrow('tidal.json', null);
  }
  // Without "replace", existing OAuth token files are ALWAYS preserved. Providers
  // already reject tokens tied to a different Client ID.
  await rm(file);
  const outcome = (filled: boolean, signedOut: boolean) => (!filled ? 'preserved' : replace ? (signedOut ? 'replaced, signed out of the old Client ID' : 'replaced') : 'filled');
  console.log(`[headunit] Private provisioning consumed: Spotify ${outcome(provisionSpotify, signOutSpotify)}, TIDAL ${outcome(provisionTidal, signOutTidal)}.`);
  return true;
}
