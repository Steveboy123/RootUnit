# Music services setup

How to connect **Spotify** and **TIDAL** to the head unit. You do this once per service. Most of the setup happens on the service's developer website.

> **Status.** Spotify and TIDAL are both wired into the Music screen. TIDAL catalog/search uses app-level Client Credentials; personal TIDAL account sign-in is optional. Details are in [spotify.md](spotify.md) and [tidal-setup.md](tidal-setup.md) (setup) and [tidal.md](tidal.md) (reference).

## What you need

* **Spotify:** your app's Client ID. Spotify's PKCE login does not use a Client Secret here.
* **TIDAL:** your app's **Client ID and Client Secret**. TIDAL catalog/search uses the Client Credentials grant. The secret is stored only on the head unit and is never returned to the browser after saving.
* **No YouTube key is involved in Spotify/TIDAL setup.** YouTube Music has its own API-key setup.
* **Internet** on the head unit while using the online music services, and a correct clock.

Until a service is configured, its Music tab shows a setup prompt instead of failing.

## Spotify, step by step

Spotify changes its dashboard from time to time, so a button may be named a little differently.

1. Open <https://developer.spotify.com/dashboard> and log in with your Spotify account.
2. Choose **Create app**. The name and description can be anything (for example "Head Unit").
3. **Redirect URI.** Add this address **exactly as the app shows it**, then press **Add** and save:

   ```
   http://127.0.0.1:8787/auth/spotify/callback
   ```

   The app shows the exact address (with a copy button) in **Settings > Music services > Spotify**,
   step 2, and `npm run setup` prints it too. It must say `127.0.0.1`, **not** `localhost`: Spotify
   rejects `localhost`. If you changed `PORT`, the number changes with it.
4. When it asks which APIs or SDKs you plan to use, tick **Web API**.
5. Save, then open your app's **Settings** page in the dashboard and copy the **Client ID**
   (not the Client secret).
6. Open **User Management** and add the name and email address of the Spotify account you will sign in
   with. Without this, Spotify refuses the sign-in with a 403.
7. Put the Client ID into the head unit ([three ways](#three-ways-to-enter-the-client-id) below), then
   [sign in](#signing-in).

## TIDAL, step by step

1. Open <https://developer.tidal.com/dashboard> and create an app.
2. Copy the app's **Client ID** and **Client Secret**.
3. On the head unit open **Music → TIDAL → Set up TIDAL** (or **Settings → Music services → TIDAL**).
4. Paste both values and save. The Client Secret input is masked; the secret stays server-side.
5. Press **Test connection**. The server requests an app token with `grant_type=client_credentials` and then performs a real TIDAL catalog search.
6. Return to **Music → TIDAL**. Search, album/public-playlist browsing and native Web Player playback work without personal-account OAuth (ordinary developer credentials may be limited by TIDAL to previews).
7. *Optional:* register the Redirect URI shown in the TIDAL card and use **Optional account sign-in** for account-scoped features TIDAL permits third-party apps to access.

TIDAL's current search endpoint is `/searchResults` with `filter[query]`. Your personal library (playlists, liked tracks) needs extra permissions such as `collection.read` and `playlists.read`: switch them on for your app in the TIDAL developer dashboard and add them under the TIDAL card's permissions, then sign in again. Without them those parts stay empty and search and playback are unaffected. See [tidal.md](tidal.md).

## Ways to enter developer credentials

Use whichever is handiest. They all end up in the same place.

**1. On the screen: Settings > Music services.** Open the service's card and save the requested developer credentials. Spotify asks for a Client ID; TIDAL asks for a Client ID + Client Secret. It takes effect immediately, with no restart. Typing on the screen is locked while the
car is moving, so park first (`npm run setup` over SSH has no such limit).

**2. In a terminal: `npm run setup`.** Run it in the project folder, on the Pi (over SSH) or on your
Windows computer. It works the same in Windows PowerShell. It prints where to create the app and the exact Redirect URI, then asks for each Client ID. For security it does not accept the TIDAL Client Secret as a command-line flag; add that from the on-screen TIDAL setup or `TIDAL_CLIENT_SECRET` in `.env`. Press **Enter** to skip a question, or `a` at
"Press Enter to continue, or a for advanced options" to change the Redirect URI (or, for TIDAL, the
permissions). A wrong Client ID is explained and asked again up to three times. If the app is already
running, restart it afterwards.

For scripts there are options (the lone `--` is how npm passes them on):

```sh
npm run setup -- --show                      # what is saved, and where each value comes from
npm run setup -- --spotify <client-id>       # save a Spotify Client ID
npm run setup -- --tidal <client-id>
npm run setup -- --spotify-redirect <address>   # only if you must use a different Redirect URI
npm run setup -- --tidal-scopes "<list>"        # TIDAL permissions, separated by spaces
npm run setup -- --forget spotify               # remove what is saved for a service
npm run setup -- --help
```

If any option is wrong, nothing is saved. The exit code is 0 for success, 1 for something you typed
that is not valid and 2 for anything unexpected.

**3. Environment variables in `.env`.** Copy `.env.example` to `.env` and fill in
`SPOTIFY_CLIENT_ID=` or `TIDAL_CLIENT_ID=` + `TIDAL_CLIENT_SECRET=`. Restart the app after editing. This is the old way and
still works; it is mainly handy when you set up the Pi from a script.

**Which one wins.** Settings and `npm run setup` (saved in `data/credentials.json`) beat `.env`, and
`.env` beats the built-in defaults. The same order applies to the Redirect URI (default:
`http://127.0.0.1:<PORT>/auth/<service>/callback`, with `PORT` normally 8787) and to the TIDAL
permissions. To go back to what `.env` says, forget the saved value: **Forget Client ID** on the card,
or `npm run setup -- --forget spotify`.

`npm run setup -- --show` prints Client IDs in full but never prints the TIDAL Client Secret or any OAuth token.

### Which service plays

**Settings > Music services > Music source** picks one service. Spotify uses its account sign-in. TIDAL is considered available once its Client ID + Client Secret are configured; personal TIDAL sign-in is optional. If no online service is configured, the demo player remains available.

## Signing in

Spotify requires an account sign-in after saving its Client ID. TIDAL catalog/search does **not** require personal-account sign-in once its Client ID + Client Secret are configured; TIDAL account OAuth is optional.

**On the head unit's own screen.** Settings > Music services > the service > **Sign in on this
screen**. The browser goes to Spotify, you approve, and it comes back to the app. This only works in
the browser that runs *on the head unit*: the Redirect URI says `127.0.0.1`, which always means "this
device". You can also open `http://127.0.0.1:8787/auth/spotify/login` in that browser.

**With your phone (QR code).** Typing a Spotify password on a car screen is awkward. Tap **Sign in
with your phone**:

1. Scan the QR code with your phone's camera (or copy the address shown under it into the phone's
   browser), log in and approve access.
2. The phone then shows a page that **cannot load**. That is expected: the Redirect URI points at
   `127.0.0.1`, which on the phone is the phone itself.
3. Copy the address of that page from the browser's address bar. It is long and ends in something like
   `?code=...&state=...`; copy all of it. Some phone browsers hide the address until you tap the bar.
4. Paste it into **Paste the address here** on the head unit and press **Finish sign-in**.

Each sign-in attempt has its own one-time code. If you wait too long, or paste an address from an older
attempt, it fails: start again from the top. **Test connection** on the card makes one harmless request
to prove the sign-in works.

### How long a sign-in lasts

For Spotify, about **six months**. That figure comes from Spotify's announcements as reported in a
third-party guide, not from Spotify's own reference, so the date Settings shows is an estimate. After
that the app tells you your sign-in expired; sign in again. Your Client ID stays saved. A network
hiccup or a Spotify outage never throws the sign-in away.

## Where things are stored

Everything is in the `data/` folder of the project (or `HEADUNIT_DATA_DIR`).

| File | What is in it | Secret? |
| --- | --- | --- |
| `data/credentials.json` | Client IDs, TIDAL Client Secret, optional Redirect URI/scopes | **Yes** — contains the TIDAL secret when saved from Settings |
| `data/spotify.json` | Spotify OAuth tokens and sign-in metadata | **Yes** |
| `data/tidal.json` | Optional TIDAL account OAuth tokens and sign-in metadata | **Yes** |

These files are written private to the account running the app (mode `0600`). Do not publish `data/`, `.env`, OAuth callback URLs or screenshots containing the TIDAL Client Secret.

## Sign out, forget, start over

| I want to | Do this |
| --- | --- |
| Sign out but keep the Client ID | Settings > Music services > the service > **Sign out** |
| Remove the Client ID (and sign out) | **Forget Client ID** on the card, or `npm run setup -- --forget spotify` (this does not sign out; also use **Sign out**) |
| Change the Client ID | Save a new one. A sign-in belongs to one Client ID, so you are signed out and sign in again |
| Reset everything | Stop the app, delete `data/credentials.json`, `data/spotify.json` and `data/tidal.json`, then start it |
| Cut the app off from the service's side | In your Spotify account, open **Apps** and remove access for your app |

## Troubleshooting

The exact wording of Spotify's and TIDAL's error pages comes from user reports, not from their
documentation, and may differ a little; the cause is what matters.

| What you see | Likely cause | What to do |
| --- | --- | --- |
| `INVALID_CLIENT` on the Spotify page | The Client ID is wrong, or you copied the Client secret instead | Copy the **Client ID** again from your app's Settings page, save it, press **Test connection** |
| `redirect_uri: Not matching configuration` (or "Invalid redirect URI") | The Redirect URI in the dashboard is not identical to the one the app uses | Copy it from the card (it has a copy button) into the dashboard, press **Add** and then **Save**. Check the port, `127.0.0.1` instead of `localhost`, no trailing slash, `http` not `https` |
| 403, or "user not registered in the developer dashboard", or the app says Spotify refused the request | Your app is in development mode and your account is not listed | Dashboard > your app > **User Management** > add the exact email of your Spotify account, then sign in again |
| The app says Spotify Premium is required | Spotify only allows remote playback control on Premium accounts | Use a Premium account (or stay on the demo player) |
| Nothing happens after approving; Settings still says not signed in | The sign-in finished in a browser that is not the head unit's, so `127.0.0.1` pointed at the wrong device; or the attempt is old | Use **Sign in on this screen** on the head unit itself, or use **Sign in with your phone** and paste the address. Start a fresh attempt |
| The QR code scans but the page will not load | Expected. The page is the Redirect URI, which cannot load on a phone | Copy that page's address and paste it on the head unit, then **Finish sign-in** |
| The pasted address is refused | It is incomplete, from an older attempt or already used | Copy the whole address (it contains `code=` and `state=`) from the newest attempt |
| "More permissions are needed" | The sign-in lacks a permission a feature uses (for example after an upgrade) | Sign in again and approve every permission it asks for |
| "Your sign-in expired" | Spotify sign-ins run out after about six months | Sign in again |
| Sign-in or the page fails with certificate or "not yet valid" errors, or everything fails the same day | The head unit's clock is wrong (a Pi with no clock battery starts with the wrong time until it reaches the internet) | Connect to the internet and check `date`; fix the time, then try again |
| 429, "rate limit" or "quota" | Spotify is limiting how often the app may ask. Development-mode apps have tight limits (reported, not in Spotify's reference) | Wait. The app slows down and retries by itself; nothing to fix on your side |
| "A Spotify Client ID is 32 letters and numbers..." | What you pasted is not a Spotify Client ID | Copy the Client ID, not the secret, from the app's Settings page |
| `npm run setup` saved a Client ID, but the screen still shows none | The running app has not re-read the file | Restart the app (`sudo systemctl restart headunit` on the Pi). Changes made in Settings need no restart |

## Staying safe

* **Never commit `data/` or `.env`** to git, and never post them. Both are already in `.gitignore`;
  keep it that way.
* **Never share tokens** or `data/spotify.json`. The address you paste after a phone sign-in holds a
  one-time sign-in code, so do not post it or screenshot it either.
* **The Client ID alone cannot sign anyone in.** It is your app's public name tag and appears in every
  sign-in address (and so in the QR code). Signing in always needs the account owner's approval on the
  service's own page.
* **If the TIDAL Client Secret ever ends up somewhere public** (chat, screenshot, commit), rotate/reset it in the TIDAL developer dashboard and save the new secret in the head unit. Spotify's Client Secret is not used by this app.
* The app only answers on the head unit itself (loopback), so the Settings screen and these files are
  not reachable from the car's Wi-Fi unless you changed `HOST` yourself.

## Wallpapers

Use your own pictures as the app background: see [themes.md](themes.md#wallpapers-your-own-pictures).

## More

* [spotify.md](spotify.md): what the Spotify features need, what Spotify's 2026 changes mean, what was
  and was not tested.
* [tidal.md](tidal.md): where TIDAL support stands.
* [pi-setup.md](pi-setup.md): installing the app on the Pi.
