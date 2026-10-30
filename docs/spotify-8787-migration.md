# Spotify port 8787 restore (v2.8.7)

**Register in Spotify Developer Dashboard:** `http://127.0.0.1:8787/auth/spotify/callback`

**TIDAL:** `http://127.0.0.1:8787/auth/tidal/callback` (unchanged).

After installing this ZIP through Software Update and restarting the head unit, the backend performs a **one-time** migration if Spotify was still saved with the exact older port 5173 redirect, or if `.env` had that value without a saved override. This is the reason a normal source-only change was insufficient. The migration does not change developer Client IDs, TIDAL Client Secret, other custom redirects, or previously saved OAuth tokens. It does not change unrelated `.env` variables. The updated redirect is saved in the private `data/credentials.json`.

In Settings → Music services → Spotify, confirm the callback shows port **8787**, then start a **new** sign-in on the Pi touchscreen. OAuth authorizations begun with 5173 must be restarted; an already issued code cannot be retargeted.

If the actual server is configured to run on a different port, that must be corrected separately: this release assumes the normal `PORT=8787` head-unit backend.

Port 5173 remains for the Vite development UI, and the legacy callback bridge source is retained only for developers who explicitly choose the old redirect afterward.
