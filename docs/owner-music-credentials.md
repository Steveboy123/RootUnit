# Spotify and TIDAL developer credentials (v2.8.8)

This release does **not** embed personal developer credentials or secrets. It preserves existing saved Spotify/TIDAL settings from your Raspberry Pi. You can update them under **Settings → Music services**, or with your local `.env` if no saved override exists.

**Spotify callback:** `http://127.0.0.1:8787/auth/spotify/callback` (register it exactly in Spotify Developer Dashboard).

**TIDAL callback:** `http://127.0.0.1:8787/auth/tidal/callback`.

On the first launch after upgrading from v2.8.6, the server moves only an old Spotify callback at port 5173 to 8787. It does **not** erase saved tokens, replace Client IDs, or alter TIDAL details. The marker file in `data/` ensures this migration does not override future user choices.

Never share `data/credentials.json`, `.env`, OAuth authorization codes, or token files. If a client secret was previously exposed, rotate it with the provider.

## Port 8787 callback in an installed head unit

Spotify authorization returns directly to the main head-unit backend at `127.0.0.1:8787`. A separate 5173 callback listener is not required for the current configuration. On upgrade from v2.8.6, a one-time migration changes only the exact old Spotify redirect to 8787 and retains your TIDAL settings, Client IDs and token files. The 5173 port is still used by Vite when developing the UI.

For login, use the Raspberry Pi browser because loopback `127.0.0.1` refers to the device opening the callback.

## Putting the owner's credentials back (v2.8.8)

The v2.8.0 import replaced the Client IDs that worked on some Pis, and every later version refuses to touch saved
credentials, so such a Pi stays on the wrong ones. v2.8.8 adds an explicit, one-time **replace** to the private
provisioning file. Put `private/music-services.json` (mode 0600) in the project folder, or in a *personal* update ZIP:

```json
{
  "replace": true,
  "spotify": { "clientId": "<32 hex characters>", "redirectUri": "http://127.0.0.1:8787/auth/spotify/callback" },
  "tidal": { "clientId": "<TIDAL Client ID>", "clientSecret": "<TIDAL Client Secret>", "redirectUri": "http://127.0.0.1:8787/auth/tidal/callback" }
}
```

On the next server start these values replace what is saved in `data/credentials.json` and anything in `.env`
(saved values win over `.env`). TIDAL permissions you chose in Settings are kept. A service whose Client ID changes
is signed out, exactly as changing the Client ID in Settings does; a sign-in for the same Client ID is kept. The file
is deleted after the import. Without `"replace"` the import still only fills a service that has no Client ID.

`private/` is git-ignored: never commit this file, and keep a ZIP that contains it private.

The startup log (`journalctl -u headunit.service -b`) now lists the callback each service uses, for example
`music sign-in callbacks: spotify http://127.0.0.1:8787/auth/spotify/callback, tidal http://127.0.0.1:8787/auth/tidal/callback`.
Each must be registered exactly in that service's developer dashboard. If the provider sends the browser back with an
error (for example `invalid_scope` when the TIDAL app has not enabled `user.read` and `playback`), the page now names
the setting to fix and shows the provider's own description.
