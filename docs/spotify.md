# Spotify

Without configuration the Music page uses a built-in **demo player and library**
(generated album art, 35 tracks, playlists, artists, a fake phone and speaker to "Play
on…") so you can design the UI offline. To use real Spotify you need **Spotify
Premium** — Spotify doesn't allow playback control from the Web API on free accounts.

![Music home](screenshots/05-music.png)

## What you get

| Feature | How it works |
| --- | --- |
| **Jump back in** — recently played, tap to resume | `GET /me/player/recently-played` |
| **Your top tracks and top artists** | `GET /me/top/tracks`, `GET /me/top/artists` |
| **Playlists, Liked Songs, saved Albums, followed Artists** | `/me/playlists`, `/me/tracks`, `/me/albums`, `/me/following` |
| **Open a playlist/album**, Play or Shuffle, tap any track to start there | `/playlists/{id}/items`, `/albums/{id}` + `PUT /me/player/play` (Spotify only lists the tracks of playlists you own or collaborate on — see below) |
| **Search** (tracks, albums, artists, playlists) | `GET /search` — see the limits below |
| **Queue** — view it, **＋** any track to add it | `GET /me/player/queue`, `POST /me/player/queue` |
| **♥ Like** the current song (Music page and the dashboard widget) | `PUT/DELETE /me/library` |
| **Play on…** — move playback to your phone or any Connect speaker | `GET /me/player/devices`, `PUT /me/player` |
| **Art-coloured accent** — the UI takes its highlight colour from the album cover | Computed in the browser from the cover image (Settings → Music turns it off) |
| **Locked while driving** — typing (search) is replaced by a notice above 8 km/h | UI only, uses the vehicle speed; **Settings → Music** turns it off, and "I'm a passenger" lifts it until reload |



## What changed in Spotify's API in 2026

Spotify tightened the Web API for *development-mode* apps in early 2026. The adapter has been
checked call by call against Spotify's reference in OpenAPI form (a community-maintained mirror
generated from Spotify's documentation, version 2026.5.31). That is documentation, not the live
service: it can differ from what Spotify really does, and it says nothing about which apps may call what.
What the reference says:

* **Search returns at most 10 results per type** (default 5, maximum 10; the app asks for 10).
* **Renamed:** a playlist's `tracks` became `items`, and each entry's `track` became `item`
  (the old names are still listed, as deprecated).
* Library saving moved to `PUT/DELETE /me/library` + `GET /me/library/contains` (with `uris=`, up to 40 at a time).
* **Playlist items** (`/playlists/{id}/items`) come at most 50 per request and only for playlists you
  **own or collaborate on** (Spotify answers 403 otherwise). A playlist you only follow, or one found
  through search, therefore opens with **Play and Shuffle but no track list**.
* **Marked deprecated** in the reference: the older `/me/tracks` (save, remove, "contains") and
  `/playlists/{id}/tracks`, artist top tracks and related artists, new releases, the "get several …"
  lookups, `/users/{id}/playlists` and the browse categories. "Deprecated" is the documentation's word:
  it doesn't say whether Spotify still answers them, and they **may still be refused to development-mode
  apps**. The adapter only uses `/me/tracks` and `/playlists/{id}/tracks` as a fallback.
* `GET /artists/{id}/albums` is **still documented and not deprecated** (at most 10 albums per request),
  so artist pages are possible. This build doesn't have them yet: tapping an artist just starts
  playing that artist.

Reported by write-ups of the changes but **not in Spotify's reference**, so unconfirmed here:

* The app **owner must have Premium**, and a development-mode app serves at most **5 users**.
* Sign-ins now **expire about six months after you approve the app** (see *What's stored*).
* An app can run out of quota and get HTTP 429 for a while.

The consequences here: there are no artist pages yet, no "new releases" or "browse" shelves, and the
adapter falls back to the older endpoints only when the new ones say "not found" (a playlist's track list)
or refuse the request (saving a track, or checking whether one is saved). Everything the adapter calls is isolated in
`apps/server/src/library/spotifyLibrary.ts`, so if Spotify changes something again, that is
the one file to adjust.

## How it fits together

```
 phone/app ──┐                       ┌── raspotify (librespot) ── audio out of the Pi
             ├─ Spotify Connect ─────┤
 this UI ────┘  (Web API: controls)  └── shows up as a Connect device named "RPI Headunit"
```

* **Audio** is played by librespot from the Raspotify arm64 package. On Raspberry Pi builds, the normal build/update step downloads the upstream package and places the receiver inside the head-unit app; it then starts automatically with the backend. The device appears in Spotify as **RPI Headunit** by default.
* **This app** is the remote control + display: it reads now-playing and sends
  play/pause/next/seek/volume through the Spotify Web API, browses your library,
  and wakes the Pi's Connect device when nothing is active.

(Playing audio *inside* the browser via Spotify's Web Playback SDK would need
Widevine DRM in Chromium on arm64; raspotify avoids that whole problem.)

## Setup

The short version is in [setup.md](setup.md), which covers the on-screen setup card and the
`npm run setup` command. The Spotify-specific steps:

1. Create an app at <https://developer.spotify.com/dashboard>.
2. For this personalized head-unit build, add this **Redirect URI** exactly: `http://127.0.0.1:8787/auth/spotify/callback`
   (Spotify rejects `localhost`; a loopback IP literal is allowed). Settings → Music services shows
   the exact address for the port the app is really using.
3. Enter the **Client ID** in Settings → Music services (or run `npm run setup`, or set
   `SPOTIFY_CLIENT_ID` in `.env`; what you enter on screen or in `npm run setup` wins over `.env`).
   No client secret is needed or used — login is OAuth **PKCE**.
4. Tap **Sign in on this screen**, or **Sign in with your phone** (see below). No restart is needed
   after entering the Client ID on screen.
5. On the Raspberry Pi, no separate Spotify-player install is normally needed. A Pi production build/update downloads the upstream Raspotify arm64 package, extracts its librespot receiver into this app, and starts it automatically as `RPI Headunit`. The Pi must be online while the update is built. Raspberry Pi OS normally already provides Avahi/mDNS; a fresh `install.sh` also installs/enables it.
6. In development mode, add the Spotify accounts that will log in (yours) under
   *User Management* in the dashboard.

> **Upgrading from an earlier version?** The library features need five extra
> permissions (`user-library-read`, `user-library-modify`, `user-follow-read`,
> `user-top-read`, `user-read-recently-played`). A token created before this change
> doesn't have them, so the library shows **"Reconnect Spotify"** — tap it (or
> Settings → Music services → Sign out, then sign in again) once and approve the new permissions.

## First login on the car

The login redirect goes to `127.0.0.1`, which always means "this device", so **Sign in on this
screen** only works in the browser running on the Pi (the touchscreen). To sign in from your phone
instead, use **Sign in with your phone**: scan the QR code, approve on the phone, then copy the page
address the phone ends up on (it cannot load, which is expected) and paste it into the head unit.
[setup.md](setup.md#signing-in) has the steps. Copying `data/spotify.json` from another machine also
still works, as long as it was created with the same Client ID.

## What's stored

`data/spotify.json` holds the access/refresh token, when you signed in, the permissions Spotify
granted and the Client ID they belong to, mode `0600`. Delete it (or use
Settings → Music services → Sign out) to sign out. The refresh token is the only long-lived
secret; treat the SD card accordingly. Library data (playlists, search results) is
fetched on demand and never written to disk.

**Sign-ins run out.** Spotify has said a sign-in now lasts about six months from the day you approved
the app (that figure comes from a third-party guide, not from Spotify's reference, so the date Settings
shows is an estimate). When Spotify refuses to renew it, the app says *"Spotify says your sign-in has
expired"* and you sign in again; a network hiccup or a Spotify outage never throws the sign-in away.

## Behaviour notes

* The UI polls Spotify every 3 s (`SPOTIFY_POLL_MS`) and interpolates the
  progress bar between polls. HTTP 429 responses are honoured via `Retry-After` (5 s if it's
  missing). If Spotify's message says the app is out of *quota*, the app waits at least two minutes
  and shows that. Spotify's reference documents neither the header nor the "quota" wording, so
  that is a best guess matched on the message text.
* "No active device" is handled: pressing play wakes the device named
  `SPOTIFY_DEVICE_NAME`; if Spotify has not discovered it yet, **Play on…** shows the local receiver status while it waits.
* Library errors are shown in plain words, not codes: *sign in again*, *reconnect for the new
  permissions*, *Spotify is rate limiting — try again in a moment*, or *Spotify Premium is required*.
  Spotify's 403 answer is generic, so any other refusal is shown as *Spotify refused the request (403)*
  followed by Spotify's own message rather than a guess.
* Long lists are read in pages of 50: up to 200 saved songs, albums, playlists or followed artists, and
  up to 400 entries of one playlist or album. "Tap a track to start there" uses the track's real position
  in the playlist or album (Spotify numbers local files and unavailable entries too), so it starts the
  right song even when some rows aren't shown.
* Shuffle sends "shuffle on" and waits for Spotify to answer before it sends "play", because Spotify
  doesn't guarantee the order of player calls.
* Ads show as "Advertisement" instead of the previous song's title.
* The library is also a small local HTTP API (loopback only, same Host/Origin protection as
  the rest): `GET /api/library/{home,playlists,liked,albums,artists,search?q=,playlist/:id,album/:id}`,
  `GET /api/queue`, `GET /api/connect/devices`, `POST /api/connect/transfer {id}`,
  `POST /api/library/like {uri,on}`. The demo catalog answers the same routes.

## What has and hasn't been tested

* **Tested:** the whole adapter against a mocked `fetch` that returns the response shapes
  described above (`spotifyLibrary.test.ts`, `mediaSpotify.test.ts`: URLs, query strings,
  error mapping, fallbacks, id validation), the HTTP routes against real server instances
  (`server.library.test.ts`), the UI against the demo catalog in a real browser.
* **Not tested: anything against the live Spotify API.** There were no credentials in the build
  environment. The calls were checked against an OpenAPI mirror of Spotify's reference (documentation,
  not the live service), which doesn't cover the sign-in requests (PKCE parameters, token
  responses) or the wording of errors (a 403 about permissions, a 429 about quota, `invalid_grant`).
  Those come from secondary sources and may be wrong in details. Expect to shake out small issues on
  the first real login, most likely in `spotifyLibrary.ts` or `mediaSpotify.ts`.
