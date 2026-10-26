# TIDAL integration

> Quick start: [tidal-setup.md](tidal-setup.md) — the three-step Client ID + Client Secret setup. This page is the reference for how the integration works.

TIDAL is a first-class source under **Music → TIDAL**, beside Spotify, YouTube Music and Radio.

## What this build uses

TIDAL's current developer platform (the v2 API at `https://openapi.tidal.com/v2`) uses two separate authorization paths in this head unit:

- **Client Credentials (Client ID + Client Secret)** for catalog/search requests.
- **Authorization Code + PKCE** for the optional personal-account sign-in. This build does not send the Client Secret in the account sign-in.

The Client Secret is stored only by the Node server in `data/credentials.json` (mode `0600`) or read from `TIDAL_CLIENT_SECRET`. The settings API only tells the browser whether a secret is configured; it never returns the secret value.

## What works

- TIDAL as its own Music tab.
- Catalog search for tracks, albums, artists and playlists using the current `/searchResults?filter[query]=...` API shape. The search asks TIDAL for the artists, albums and artwork together with the results, so one request is enough when TIDAL answers with all of it; anything it leaves out is fetched afterwards, one request per kind (the old behaviour).
- Album and public playlist browsing. The first 100 tracks of an album or playlist are loaded (up to 5 pages of TIDAL results).
- Artwork, artist/album metadata and a local previous/next queue. Track and album versions such as "Remastered 2011" are shown after the title.
- Native head-unit playback through TIDAL's official Web Player SDK: our own album art, seek, play/pause, previous/next, volume and queue controls; no TIDAL iframe (see [Playback](#playback)).
- A connection test that obtains an app token with the Client Credentials grant and performs a real catalog search.
- Optional TIDAL account OAuth + token refresh for account-scoped endpoints that TIDAL exposes to the app (see [Optional account sign-in](#optional-account-sign-in)).

## One-time setup

1. Open the TIDAL Developer dashboard and create an app.
2. Copy both the **Client ID** and **Client Secret**.
3. Start the head unit and open **Music → TIDAL → Set up TIDAL**.
4. Paste the Client ID and Client Secret and save.
5. Press **Test connection**. A successful result confirms the Client Credentials token and catalog search are working.
6. Return to **Music → TIDAL** and search for music.

You can also set `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` in `.env` instead of storing them from the screen.

## Optional account sign-in

The TIDAL catalog does not require your personal TIDAL account in this build. If you want to try account-scoped features, register the exact Redirect URI shown in the TIDAL connection card (normally `http://127.0.0.1:8787/auth/tidal/callback`) and use **Optional account sign-in**.

### Permissions (scopes)

The default account permissions are `user.read playback`. `user.read` identifies the signed-in account; v0.2.2 adds `playback` for the native player. An older sign-in that only has `user.read` should be signed in again once after updating.

The v2 API gates the personal parts of your account behind scopes. They are named like `collection.read` (your TIDAL collection: favourite tracks, albums, artists and saved playlists) and `playlists.read` (the playlists you created). The scopes your app may use depend on its access tier; **you enable them for your app in the TIDAL developer dashboard**. TIDAL's `GET /scopes?filter[requiredAccessTier]=THIRD_PARTY` lists what a third-party app can request, and the dashboard shows the same list for your app. (The old `r_usr` / `w_usr` style scopes belong to TIDAL's previous v1 API and play no role here.)

To add library permissions beyond `user.read playback`:

1. Enable the scopes in the TIDAL developer dashboard for your app.
2. In the head unit open **Settings → Music services → TIDAL**, find **Permissions to ask for**, and enter them separated by spaces, for example `user.read playback collection.read playlists.read`. (The same setting exists as `TIDAL_SCOPES` in `.env` and as `npm run setup -- --tidal-scopes "<list>"`.)
3. Use **Optional account sign-in** again so TIDAL can grant them.

What to expect:

- If you ask for scopes that your app has not enabled, TIDAL may refuse the sign-in. Clear the field to go back to the default and the sign-in works again.
- If the permissions you configured are wider than what the saved sign-in was granted, the card shows **Needs permissions** with the plain message *Sign in again to grant: …*. You stay signed in. The message is worked out from what TIDAL granted, so it goes away by itself once a sign-in (or a token refresh) carries the missing scopes. If it does not go away, TIDAL is not granting them: check that they are enabled for your app.
- Your collection pages (liked tracks, albums, artists, playlists) read your account. Without the permission TIDAL answers 403 and the head unit shows an empty list quietly; that alone never marks the card as broken.
- Collections are read newest first, up to 100 items each.

### Country

TIDAL decides what is available from the country sent with each catalog request:

1. `TIDAL_COUNTRY` (two letters, for example `DE`) in `.env` or the environment, if set.
2. Otherwise, while you are signed in with `user.read`, the country of your TIDAL account (read once from TIDAL and remembered with the sign-in).
3. Otherwise `US`.

Tracks that TIDAL says cannot be streamed are flagged as not playable by the server; the Music page does not hide them yet.

## Playback

The visible TIDAL player is now entirely part of the RPI Headunit UI. There is **no TIDAL iframe**. The browser loads TIDAL's official Web Player SDK and the head unit renders its own album art, progress bar, play/pause, previous/next, volume and queue controls. Progress and track-end are visible to the head unit, so the queue advances automatically.

The Web Player still has to authenticate with TIDAL. The Node server keeps the Client Secret and refresh token private. The local Chromium kiosk may request only a short-lived access token from `/api/tidal/player-credentials`; that route accepts loopback requests only, so another phone/computer on the LAN cannot fetch the token. If a personal TIDAL account is signed in, its short-lived access token is tried first. If TIDAL refuses its playback entitlement, the player automatically falls back to Client Credentials preview playback.

### TIDAL's full-track limitation

TIDAL controls whether a third-party developer app gets a full asset or a preview. Client Credentials generally provide a roughly 30-second preview. A signed-in user token can be tried, but TIDAL may still return `FULL_REQUIRES_HIGHER_ACCESS_TIER`; this is an access-tier restriction on the developer app, not something the head unit can bypass. The UI detects a short media asset and labels it **Developer preview** instead of pretending it is a full track.

The SDK versions are pinned by this build (`@tidal-music/player` 0.20.1, `@tidal-music/auth` 1.6.2 and `@tidal-music/event-producer` 2.6.0). They are loaded as ESM modules at runtime so the v0.2.2 update remains compatible with the updater already installed on v0.2.1; no new npm dependency is required for the staging `npm ci` step.

TIDAL Connect is still not exposed as a renderer because it is a separate device-partner integration rather than a general public Connect API.

## When TIDAL has a bad moment

- Every request to TIDAL times out after 12 seconds, so a stalled connection cannot freeze the Music page.
- A catalog read that TIDAL answers with "too many requests" is repeated up to twice after the wait TIDAL asks for (never more than 5 seconds; a longer ask is reported as it is), and one that fails on TIDAL's side is repeated once. Nothing else is repeated.
- If the connection to TIDAL is down while the sign-in is being refreshed, the page says *Could not reach TIDAL* and keeps your sign-in. Only when TIDAL says the sign-in is no longer valid is it removed, and the card then asks you to sign in again.
- Signing out while a refresh is in progress really signs you out: the late answer is discarded.
- A sign-in or sign-out that cannot be saved on the head unit's disk says so instead of looking successful. If a saved file is damaged, a copy of the last good content (`<name>.bak`) is used and the damaged file is kept as `<name>.corrupt-<time>` next to it.


### Account playback permission

Native playback asks TIDAL for the `playback` OAuth scope in addition to `user.read`. If this Pi was signed in before v0.2.2, Settings may ask you to sign in to TIDAL once more so the new playback permission can be granted. If TIDAL does not grant full playback to the developer app, the native player falls back to the developer preview path.
