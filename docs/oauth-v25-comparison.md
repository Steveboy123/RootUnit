# v2.5.0 versus v2.8.5: Spotify & TIDAL login comparison

## Findings

- The OAuth providers (`mediaSpotify.ts` and `mediaTidal.ts`) had no substantive changes from v2.5.0 through v2.8.2. A changed token protocol does not explain a regression beginning in v2.8.0.
- v2.8.0 introduced `private/music-services.json` automatic import at every new installation/upgrade. It *overwrote* previously saved developer Client IDs (Spotify and TIDAL), reset Spotify's redirect URI, and deleted `spotify.json`/`tidal.json` when the Client ID changed. This was a real regression risk.
- v2.8.2 added a dedicated loopback 5173 listener for the Spotify callback, which redirects to the existing 8787 handler. Spotify's actual token request still uses the configured 5173 URI.
- v2.8.4–v2.8.5 added more connection diagnostics and retries, but can't repair a changed/misconfigured developer app, an invalid OAuth code, or wrong saved settings.
- On the affected Pi, GET and a deliberately invalid POST both reached the Spotify and TIDAL token servers. This confirms connectivity in those tests but not an actual login's PKCE/code flow.

## v2.8.6 changes

- Update ZIP no longer contains a plaintext preprovisioned Client Secret. Use the Pi's preserved credentials, `.env`, or Music Settings.
- If an administrator later supplies `private/music-services.json` manually, import fills **missing** services only, never overwrites any saved service already configured or one configured in `.env`.
- Existing Spotify/TIDAL token files are never deleted by provisioning.
- A private, read-only diagnostic script (`deploy/compare-music-config.sh`) compares configured sources and token existence without printing credentials.

## Important limitation

Installing this update does not reconstruct credentials or authorizations that v2.8.0 already replaced. In the UI, verify the current Client IDs and redirects against the developer dashboards, then start a **fresh** login. Verify the successful Connected status after returning from the provider. If you had a different, working Client ID in an earlier installation, restore it **through Settings**, not by copying token files from another Client ID.

**Spotify requested redirect URI (v2.8.7):** `http://127.0.0.1:8787/auth/spotify/callback` (the Pi only; log in in the Pi browser).

**TIDAL default redirect URI:** `http://127.0.0.1:8787/auth/tidal/callback`.

Don't share `.env`, `data/credentials.json`, `data/spotify.json`, `data/tidal.json`, full callback URLs (authorization codes), or logs with tokens.

## v2.8.7 follow-up

The user requested the original :8787 callback again. A narrowly-scoped first-start migration replaces only the exact legacy Spotify :5173 redirect (saved or previously set in .env); TIDAL and OAuth tokens are preserved.
