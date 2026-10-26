# Running RootUnit on Windows

Test the real app on a Windows PC before it goes in the car: real Spotify, TIDAL, YouTube Music and internet radio, with every look,
layout and animation. The parts that need the Raspberry Pi's own hardware simply show as off.

## What works on Windows

| Works | Needs the Pi (shows as off or unavailable) |
| --- | --- |
| The whole interface: every look, theme, layout, widget and animation | The Pi's built-in Spotify player ("RPI Headunit" native): use the browser player instead |
| **Spotify**: sign in, your library, search, controls, playback in the browser (Premium) or on any Spotify device | Bluetooth phones |
| **TIDAL**: catalogue, search and playback through TIDAL's own web player | The Pi's volume, brightness and sound outputs |
| **YouTube Music**: search, playlists and playback in the embedded player | GPS, FM transmitter, Android Auto, dashcam |
| **Internet radio**, with search and favourites | The boot screen and software updates |
| Weather (search your town in the Weather app), synced lyrics, garage, trips, notes, timers, scenes, tools, arcade | |
| Backups, My looks and share codes; WLED lights on your network; an OBD-II adapter on a COM port (`OBD_PORT=COM5` in `.env`) | |

## 1. Install

* **Node.js**, the LTS version, from <https://nodejs.org> (22.9 or newer). Keep **Add to PATH** ticked in the installer.
* **Google Chrome or Microsoft Edge.** Spotify's and TIDAL's in-browser players need the protected-content support these two have.
* **Git** (optional) from <https://git-scm.com>, to download and update with one command. Without it, use the ZIP below.

## 2. Get RootUnit

* **ZIP:** on GitHub open **Steveboy123/RootUnit**, switch the branch to **Create**, then **Code → Download ZIP**. Before you extract
  it, right-click the ZIP → **Properties** → tick **Unblock** → OK, so Windows does not question every file. Extract to a short path
  such as `C:\RootUnit`.
* **Git:** `git clone --branch Create https://github.com/Steveboy123/RootUnit.git C:\RootUnit`

Keep it **out of a OneDrive folder** (Desktop and Documents often are): OneDrive locks files while it syncs, which can break the install.

## 3. Start it

Double-click **`start-windows.cmd`** in the folder.

* The **first time** it installs and builds RootUnit, which takes a few minutes. After that it starts in seconds.
* Your browser opens **<http://127.0.0.1:8787/?frame>**: the app inside a car-screen frame, with buttons along the top for
  800×480, 1024×600, 1280×720 and 1280×400. Open <http://127.0.0.1:8787> without `?frame` to fill the window (F11 for full screen).
  A touchscreen laptop works like the car screen.
* The black window shows what RootUnit is doing. **Close it to stop RootUnit.**
* If Windows SmartScreen says "Windows protected your PC", choose **More info → Run anyway** (or unblock the ZIP, above).

By hand, in a terminal in the folder, it is the same three commands: `npm install`, `npm run build`, `npm start`.

## 4. Spotify

You need **Spotify Premium**: Spotify only lets apps control playback for Premium accounts.

1. Open <https://developer.spotify.com/dashboard>, log in and **Create app**. Any name and description.
2. **Redirect URI:** add exactly `http://127.0.0.1:8787/auth/spotify/callback`, then **Add** and **Save**. It must say
   `127.0.0.1`, not `localhost` (Spotify refuses `localhost`).
3. When it asks which APIs you will use, tick **Web API** and **Web Playback SDK**.
4. Open the app's **Settings** and copy the **Client ID** (you do not need the Client secret).
5. Open **User Management** and add your own name and Spotify e-mail. A new Spotify app only works for the accounts listed there.
6. In RootUnit: **Settings → Music services → Spotify**, paste the Client ID, **Save**, then **Sign in**. Allow it on Spotify's page and
   you come back to RootUnit.
7. Open **Music → Spotify**. To choose where the sound comes out, tap the device button on the player (**Play on…**):
   * **Browser fallback** plays in this browser window. It appears in Spotify as *RPI Headunit Web Fallback*.
   * Or pick the **Spotify app** on your PC or phone, or any speaker you have.
   * *RPI Headunit (native)* says it is only built into the Raspberry Pi version. That is expected on Windows.

## 5. TIDAL

1. Open <https://developer.tidal.com/dashboard>, sign in and create an app.
2. Copy its **Client ID** and **Client Secret**.
3. In RootUnit: **Music → TIDAL → Set up TIDAL** (or Settings → Music services → TIDAL), paste both and save. Search and the catalogue
   work straight away.
4. Optional, for your own account: add `http://127.0.0.1:8787/auth/tidal/callback` as a redirect URI in the TIDAL dashboard, then
   **Sign in** in RootUnit.

TIDAL may limit developer apps to 30-second previews; the player says so when it happens. More in [tidal-setup.md](tidal-setup.md).

## 6. YouTube Music

1. Open <https://console.cloud.google.com>, create a project, then **APIs & Services → Library → YouTube Data API v3 → Enable**.
2. **Credentials → Create credentials → API key.** Restricting the key to the YouTube Data API v3 is a good idea.
3. In RootUnit: **Music → YouTube Music → Set up YouTube Music**, paste the key and save.

No sign-in is needed. More in [youtube.md](youtube.md).

## 7. Radio

**Music → Radio → Find**: search stations by name or style. Nothing to set up.

## Your data

Settings, saved looks, stations, garage, trips and sign-ins are kept in the **`data`** folder inside RootUnit.
`data\credentials.json` holds your music sign-ins and keys: keep it private and never share it. **Settings → Backup & update** makes a
backup file without any of them. To start again from scratch, close RootUnit and delete the `data` folder.

## The demo

To try the simulated car (fake drive, phones and music) instead, run `npm run dev` in a terminal in the folder and open
<http://127.0.0.1:5173>. It keeps its own `data-demo` folder, so it never mixes with your real settings.

## Updating

* **Git:** `git pull`, then run `start-windows.cmd rebuild` (in a terminal, or make a shortcut with `rebuild` after it).
* **ZIP:** download the new ZIP into a new folder, copy your old `data` folder into it, then double-click `start-windows.cmd`.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `'node' is not recognized` | Install Node.js again with **Add to PATH** ticked, then open a new window. |
| `INVALID_CLIENT: Invalid redirect URI` (Spotify) | The redirect URI in the Spotify dashboard must match the one RootUnit shows in Settings → Music services → Spotify, step 2, letter for letter. |
| "You are not registered for this application" | Add your Spotify account under **User Management** in the dashboard. |
| "Spotify Premium is required" | Playback control needs Premium. Browsing still works. |
| No sound from Browser fallback | Use Chrome or Edge, and allow protected content (Edge: `edge://settings/content/protectedContent`; Chrome: `chrome://settings/content/protectedContent`). Tap **Play on… → Browser fallback** again. |
| Port 8787 is already in use | Copy `.env.example` to `.env`, set `PORT=8790`, and use that port in every redirect URI. |
| `npm install` fails with `EPERM` or "file in use" | Move the folder out of OneDrive, close editors and antivirus scans of it, and try again. |

This guide was written from the code and tested on Linux with the same production build, with none of the car hardware present. It has
not been run on a Windows PC yet, so if a step does not match what you see, say which one.
