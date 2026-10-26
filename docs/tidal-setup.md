# TIDAL setup

The TIDAL setup screen requires **both** the Client ID and Client Secret. The redirect URI is only used for optional account OAuth; it is not needed for the Client Credentials catalog connection.

1. Create your app in the TIDAL Developer Portal.
2. Copy the Client ID and Client Secret.
3. In the head unit open **Music → TIDAL → Set up TIDAL**.
4. Enter both values and save.
5. Press **Test connection**.
6. A successful test means the server obtained a TIDAL app token and reached the catalog API.

The Client Secret is stored by the server and is never returned to the browser.

## Good to know

- **Playback:** tracks play in the native RPI Headunit TIDAL player using TIDAL's official Web Player SDK — no iframe. You get album art, seek, play/pause, previous/next, volume and automatic queue advance. TIDAL may still limit ordinary third-party developer apps to ~30-second previews; the UI labels that honestly.
- **Optional account sign-in** uses `user.read playback` by default (`playback` was added for the native player). To read your TIDAL collection or playlists, enable scopes such as `collection.read` and `playlists.read` for your app in the TIDAL developer dashboard, then add them under **Settings → Music services → TIDAL → Permissions to ask for** (or `TIDAL_SCOPES` in `.env`) and sign in again.
- **Country:** results follow `TIDAL_COUNTRY` (for example `DE`) if you set it, else the country of your signed-in TIDAL account, else `US`.

The full reference is in [tidal.md](tidal.md).


### Account playback permission

Native playback asks TIDAL for the `playback` OAuth scope in addition to `user.read`. If this Pi was signed in before v0.2.2, Settings may ask you to sign in to TIDAL once more so the new playback permission can be granted. If TIDAL does not grant full playback to the developer app, the native player falls back to the developer preview path.
