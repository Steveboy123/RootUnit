# Changelog

## 3.1.0: more styles, animations and your own looks

**Themes and styles.** Eight palettes (Neon Noir, Miami, Toxic, Rose Gold, Abyss, Holo, Paper, Peach; 44 in all). Four card styles:
Brutalist, Holographic, Terminal, Lumen. Four backgrounds: Halftone, Low poly, Sun rays, Plasma. Six wallpapers: Cherry road, Cyber
alley, Miami beach, Deep sea, Holo waves, Paper hills. A new **Styles** group of 14 looks built around them, each matched end to end.

**Animations.** Six scenes (Highway, Sakura, Embers, Radar, Skyline, Storm), four page transitions (Cube, Drop, Tilt, Portal), three
touch effects (Sparkle, Ring, 3D press), three album-art styles (Cube, Mirror floor, Sleeve), two navigation bars (Neon tube, Bubbles),
two mascot motions (Bounce, Drift) and auras (Rings, Aurora). All of them only move transform and opacity, and rest while driving.

**Gauges and clocks.** An LED race dash and a HUD gauge; Nixie, word-clock and binary standby screens.

**Your own looks.** *My looks* saves the look on screen under a name, wears it again in one tap and shares it as a code another head
unit can add. *Surprise me* puts together a random look that still matches. *Reset the look* is unchanged.

**More.** The WLED lights can match the screen's colour. Three widgets: Calendar, My looks, and a Sound meter that shows the real
music level (and says so when there is no meter, rather than inventing one). The garage service form has its Note field back.

**Windows.** Double-click `start-windows.cmd` to install, build and run the real app on a Windows PC, with real Spotify, TIDAL,
YouTube Music and radio ([windows.md](windows.md)). It repairs an install that ended up without its build tools.

**Checked by tests:** every new palette against the contrast and distinctness rules; every new option used by at least one look; saved
looks and share codes against damaged and hostile input; the word and binary clocks; and the CSS rules, now including that no
animation name is defined twice.

## 3.0.0 — RootUnit

A new interface and a much bigger choice of looks, with every v2 feature kept. Guides: [themes.md](themes.md),
[3d-motion.md](3d-motion.md), [navigation.md](navigation.md), [mascot-boot.md](mascot-boot.md).

**Looks.** 61 one-tap looks (6 featured, 25 signature, v2's 16 3D scenes and 14 looks), each setting palette, wallpaper, cards,
depth, glass, motion, typeface, transitions, gauges, navigation style and the mascot together so nothing clashes. v2's *Liquid Chrome*
scene is now *Silver Grid*. Four Home layouts (Cockpit, Player focus, Glass hub, Classic) that also place the mascot so it never
shows twice.

**More of everything.** 36 palettes (was 17), 8 card styles, 7 depths, 6 glass finishes, 19 backgrounds, 20 built-in wallpapers,
18 animated scenes, 15 album-art styles, 7 page transitions, touch effects, 8 typefaces, 6 gauge styles, 6 standby screens, 9
music-reactive styles, 10 mascot motions and 4 auras, and switches for album glow and background motion. Any accent colour through
Hue and Lightness, kept readable. *Reset the look* puts it all back.

**Navigation.** Ten bar styles (classic dock, edge rail, floating pill, minimal icons, glowing curve, 3D glass, split with the
album art, text tabs, wave, mascot) and a new bottom position. On a short screen the bar scrolls instead of pushing the page off.

**New screens and apps.** Settings is a full page in two groups (*Look and feel*, *Head unit*). A Home hero player, clock and
weather, FM tuner, quick tiles and vehicle card widgets. An Apps carousel. Tall volume and brightness sliders in the Quick Panel. FM
with a 3D dial and band spectrum. New apps: Sleep sounds and Tools (converter, tip split, world clocks).

**Boot Studio.** Five more themes (Hyperdrive, Vaporwave, Blueprint, Ember, Plague doctor), stars, warp, colour-mesh and synth-sun
backgrounds, glitch, breathe and 3D-spin mascot motions, pulse, wave, segments, orbit and heartbeat loaders, neon, glitch, outline
and future lettering, slide, iris, warp and shutter hand-overs, and a *Default look* button. Saved v2 designs keep working.

**Checked by tests:** every CSS rule for the Pi (only transform and opacity animate, no layout transitions, one token for
backdrop-filter, every variable defined, every animation's keyframe exists, decorative motion stops while driving), and that the
boot page draws every Boot Studio choice.

## 2.1.0 — customisable navigation

The navigation bar, the Quick Panel and the Apps screen can now be arranged by the person who owns the head unit. The full guide,
with pictures, is [navigation.md](navigation.md).

**Navigation.** Hold any button (or use Settings → Navigation, or the Quick Panel's bottom row) to open an editor that sits beside
the live navigation: add pages, any app, a music tab (Spotify, TIDAL, YouTube Music, Radio), a scene or a quick action; move, rename
(10 characters) and re-picture them (42 pictures); pin two below the line next to Settings; choose the side of the screen, the size
and when names show; or start from a ready-made arrangement. A navigation with more buttons than fit scrolls, with the pinned ones and
Settings staying put. Scenes and actions need two taps.

**Quick Panel, Apps, dashboard.** Show, hide and re-order the Quick Panel's tiles and sections; hold an Apps tile to add it to the
navigation or hide it (a *Hidden* button brings hidden apps back, and an app that needs attention is never hidden from view); change
the order of the dashboard pages. A one-time tip says that a hold changes the navigation.

**Safe by design.** Everything above is **refused while the car is moving** (8 km/h, held for a minute after the speed signal
drops out; "I'm a passenger" and the Settings switch lift it), and an open editor saves and closes when the car starts moving.
Settings can never leave the navigation; the Quick Panel always has Home, Apps and Settings along its bottom; `?nav=default` on the
address resets the navigation; a navigation that fails to draw is replaced by a plain one; a failure anywhere shows a Reload screen
instead of a blank one. Every value is checked by one piece of code on the screen, on the server and in a restored backup, and
nothing that arrives damaged can leave an empty navigation.

**Backup.** The three arrangements are part of a backup. A backup made before this version leaves the arrangements you have set up
since. Going back to 2.0.0 forgets them (2.0.0 does not know them).

**Fixes made on the way.**
* Light themes (Daylight, Sand, Mint, Sunlit) painted a dark page behind their light cards (an inline background in `index.html`
  beat the theme), so the clock and top-bar text were close to invisible (about 1.1:1). The theme now decides; they measure 12 to 21:1.
* The on-screen keyboard could type past a field's length limit.
* Kiosk drag-scrolling did not start on an icon.

**Found by independent review and fixed before release:** a held press was cancelled by the smallest movement (a mouse always
jitters); the click that ends a hold could land on the menu the hold had just opened and hide an app; the rail's buttons for a group
you were already inside did nothing; compact buttons were 43 px wide on the short screens; the editor could be left covering the
screen when the car started moving; editing was possible through Settings, the tile menu and the page order while moving; a lazy
editor that failed to load blanked the screen; changes made while the head unit could not be reached looked saved and were not;
and a handful of accessibility gaps (Escape, focus, the inert page behind the editor, the spoken armed state, the picture grid's
43 tab stops).

**Not verified on real hardware**: the touch feel of the hold gesture, and everything that was not verifiable without a Pi and a car
(see the README's status table). The hold time is 800 ms with 8 px allowed to slip; if it feels wrong on the real panel, those two
numbers are in `apps/ui/src/lib/nav/longPress.ts`.

---

## 2.0.0 — the v2 rebuild

A redesign of the whole interface and a large set of new features, built on the v0.5.0 hardware integrations (Spotify, TIDAL,
YouTube Music, OBD-II, Bluetooth, Wi-Fi, reverse camera, kiosk, updater), which are kept.

**New interface.** A left navigation rail (Home, Drive, Music, Auto, Apps, Settings), a status cluster that opens a Quick Panel
(volume, brightness, day/night, rear view, standby, passenger mode, scenes, quick actions, sleep timer), a Drive screen with a
big speedometer, a full-screen Now Playing with synced lyrics, a standby clock, and an Apps launcher with badges ("1 overdue",
"Recording"). The widget dashboard is kept and gets a new "Today" page and eight new widgets.

**New apps.** Trips, Garage (fuel log, service reminders, documents), System (Pi power, heat, storage), Find my car (compass and
parking meter), Performance (0-100, quarter mile), Weather, Scenes, Quick actions, Notes, Timers, Arcade (2048, Snake) and the
Car Lab apps rebuilt on the shared live connection: GPS (offline track map), Lights (WLED), Dashcam.

**Behaviour.** Day/night can follow the real sunrise and sunset where the car is (computed offline). Alerts now also cover the
Pi's health, overdue garage items and road-hazard weather. A trip in progress survives the power being cut with the ignition.
Backup and restore of everything that is yours, without sign-ins or web-hook addresses.

**Fixes found on the way.** GPS never connected to gpsd in v0.5.0 (the socket was created but never connected). A throttle flag
value that was not valid hex read as "all clear". Several stale tests and the removed demo providers broke the build; the demo
is now an explicit `--demo` mode that can never run on a real head unit.

**Demo mode.** `npm run dev` starts a simulated car, phones, GPS, music library and (offline) weather and lyrics, labelled
DEMO on screen, with its own data folder. Production never simulates anything.

**Not verified on real hardware.** Everything was built and tested without a Pi, a car, a GPS receiver, an ESP32 or a camera.
See the status table in the README.

---

## Earlier releases

The notes below are the README of v0.5.0, kept as they were.

## v0.5.0 · Car Lab / USB GPS / WLED / Dashcam / Wired USB Android Auto

This version builds directly upon the **v0.4.4 Widget Drag Fix**, preserving its existing UI, widget placement behavior, music, Bluetooth, Wi-Fi, reverse camera and OBD features.

- **Car Lab** sidebar page: GPS, music-reactive ESP32/WLED cabin LEDs, USB dashcam, protected parking security events, FM hardware status, and extra car-computer ideas.
- **GPS widget**: GPS speed/satellites, saved parking position, trip distance, route GPX/CSV export, GPS `gpsd` setup tool, optional online map and directions.
- **WLED:** private LAN ESP32 control, on/off, brightness and color, ESP-native sound effects, experimental Pi PipeWire monitor to realtime WLED UDP output.
- **Dashcam:** camera detection, FFmpeg 720p recording into rotating MKV segments, save protected finished clip, fixed storage cap, optional authenticated ESP32 alerts.
- **Wired Android Auto:** old ADB/head-unit-server/hotspot flow disabled. USB detection plus optional genuine wired projection engine via **LIVI**. The provided `deploy/install-livi-wired.sh` fetches the upstream pinned ARM64 AppImage on the Pi, checks its release SHA-256 and integrates it on demand without changing desktop autostart. Full projector integration requires on-device testing.
- **FM transmitter:** intentionally unavailable on Pi 5, because PiFM GPIO clock tools target earlier SoCs. No misleading broadcast controls or illegal unfiltered RF output.

**Install:** extract ZIP into a new directory and run `sudo ./install.sh` on the Pi as with the previous version. Run `sudo ./deploy/setup-gps.sh` when the DFRobot GPS is connected, then `sudo systemctl restart headunit.service`. To install LIVI independently, run `./deploy/install-livi-wired.sh` **as your normal desktop user** followed by a headunit restart. Read [`docs/car-lab.md`](docs/car-lab.md) for wiring, sensors, capture limits, prerequisites and the exact distinction between ready integrations and hardware-dependent options.

**Hardware testing / deployment notice:** build dependencies were not downloadable in the packaging environment; this source ZIP needs the included Pi installation script to install/build the Node/React dependencies on the Pi. Neither LIVI wired projection nor physical GPS/LED/camera hardware has been verified against your specific equipment.

---

## v0.4.0 kiosk white-screen recovery

- Reverts the dedicated Chromium profile introduced in v0.3.7 and returns to the previously working normal Chromium profile.
- Keeps `--password-store=basic` but kills any stale head-unit Chromium process before launch so the flag actually applies.
- Removes all boot-time window-focus/minimize helpers from the kiosk path. Android Auto remains on-demand.
- Waits for both `/api/health` and the built Head Unit HTML before starting Chromium.
- Adds a dark boot/error fallback instead of an unexplained white screen.
- Writes Chromium startup/runtime output to `~/.local/state/rpi-headunit/chromium.log`.

## v0.4.4 touchscreen widget placement fix

Dashboard edit mode now uses grid-relative pointer capture instead of react-grid-layout's built-in touch dragging. Widgets keep their offset under your finger, snap to the nearest valid 12×6 dashboard cell, stay inside the grid, refuse overlaps, and save only on release. The kiosk mouse-emulation scroll fallback is disabled over the grid while editing so it cannot steal the drag.


## v0.4.3 connectivity controls

Settings now includes touchscreen Wi-Fi and Bluetooth management. Wi-Fi supports scan, connect/disconnect, saved networks, auto-connect, password edits and forget. Bluetooth supports scan, temporary discoverability, pair, connect/disconnect, trust, rename and forget. Run `sudo ./install.sh` once for v0.4.3 because it installs the root-owned NetworkManager/BlueZ helper used by the unprivileged backend.


## v0.3.9 display ownership fix

The dashboard owns the screen at boot. OpenAuto is on-demand only: ADB Wi-Fi can reconnect quietly, but the native Android Auto window is not started until the phone Head Unit Server answers and the user starts the session.

# RPI Head Unit

### v0.2.6 build fix

The Raspberry Pi production build now compiles only runtime UI/server code. Test files and legacy simulator-only provider files are excluded from the production typecheck/build, so removed demo/mock types cannot break `sudo ./install.sh`. The runtime remains hardware/services-only.

## One-command Raspberry Pi 5 installation

On Raspberry Pi OS 64-bit, from the project directory:

```sh
sudo ./install.sh
```

The installer detects the logged-in desktop user, installs Node.js 22+ and required
OS packages, runs `npm install`, builds the production app, installs/enables the
`headunit.service`, configures the labwc Chromium kiosk autostart, and installs the
on-demand wired Android Auto support (optional external LIVI receiver installed separately). On the Pi it also forces
**hardware/services-only mode**: the runtime contains no demo player, fake drive cycle, fake phones/system controls, or simulated Android Auto receiver.

The installer keeps your existing credentials/settings in `.env`, but updates the
hardware/runtime keys needed by the Pi.


`deploy/install-livi-wired.sh` adds the optional genuine USB receiver. The legacy `deploy/install-android-auto.sh` command now forwards to it.


A customizable car head unit for a **Raspberry Pi 5** and a small touchscreen
(6" now, 7" later). The UI is a web app shown in a fullscreen Chromium kiosk, so
the interface runs in a fullscreen Chromium kiosk on the Pi.

```
┌────┬──────────────────────────────────────────────────────┐
│Home│ Drive  Engine                         ✎  07:03       │
│    ├──────────────┬───────────────────┬───────────────────┤
│Music│  speedo     │   now playing     │  clock            │
│    │              │                   ├───────────────────┤
│Auto │              │                   │  volume/brightness│
│    ├──────────────┼───────────────────┼───────────────────┤
│Sett.│  trip        │   launcher        │  fuel             │
└────┴──────────────┴───────────────────┴───────────────────┘
```

![Dashboard while driving, accent taken from the album art](docs/screenshots/01-dashboard-drive.png)

| | | |
| --- | --- | --- |
| ![Music library](docs/screenshots/06-music-home.png) | ![Queue](docs/screenshots/09-music-queue.png) | ![Locked while driving](docs/screenshots/13-music-locked-while-driving.png) |
| ![Play on…](docs/screenshots/11-music-play-on.png) | ![Vehicle: fault codes](docs/screenshots/16-vehicle-obd.png) | ![Devices](docs/screenshots/15-devices.png) |

All 24 are in [docs/screenshots](docs/screenshots) at the real panel sizes (1024×600; two at
catalog, not a real Spotify account; the camera shot is Chromium's fake test feed; the vehicle
shots come from the OBD emulator.**

## What works today

| Feature | Status |
| --- | --- |
| Customizable dashboard — drag, resize, add/remove widgets, multiple pages, swipe between pages, saved on the server | ✅ done, tested with real touch events |
| 11 widgets: speedometer, tachometer, configurable gauge (9 metrics), now playing (with ♥), clock, trip, volume/brightness, launcher, radio presets, phones, **Jump back in** (recently played) | ✅ |
| **Themes** — 17 palettes (Midnight, Carbon, AMOLED, Ember, Ocean, Forest, Aurora, Synthwave, Nord, Mocha, Crimson, Royal, Daylight, Sand, Mint, plus High-contrast and Sunlit for direct sun), Solid / Glass / Outline / Neon surfaces, **album-art blur / cover / ambient** and wallpaper backgrounds (built-in scenes or your own pictures), 14 one-tap Looks, minimal/balanced/full effects for the Pi — [docs/themes.md](docs/themes.md); accent colours, metric/imperial, 12/24 h, **automatic day/night switching** | ✅ contrast-tested for every palette, browser-tested · Pi performance by construction (one blur layer), **not measured on real Pi hardware** |
| **Devices** — paired phones via BlueZ, battery when reported, connection state and active device | ✅ real BlueZ provider; signal/carrier depend on what Bluetooth exposes |
| **Internet radio** — presets widget, favourites, live now-playing text, station search | ✅ tested end-to-end with a real MP3 stream · ⚠️ built-in station URLs and directory search unverified (no internet in the build env) · FM/DAB needs hardware — [docs/radio.md](docs/radio.md) |
| **Reverse camera** overlay with parking guides; triggerable from a GPIO/curl | ✅ tested with a fake camera device · reverse-light wiring is a documented sketch |
| **Alerts** — overheating, battery voltage, low fuel, phone battery | ✅ |
| **Spotify** — OAuth PKCE login, now playing, seek/shuffle/repeat, wakes the Pi's Connect device | ⚠️ unit-tested with a mocked API; **not yet run against live Spotify** — [docs/spotify.md](docs/spotify.md) |
| **Music library** — Home (recently played, top tracks/artists), playlists, Liked Songs, albums, artists, search, queue (view + ＋ add), ♥ like, **Play on…** any Spotify Connect device | ✅ built and browser-tested against the offline catalog · ⚠️ the Spotify side is tested against a mocked API shaped like Spotify's **Feb 2026 development-mode rules** (no artist pages, search ≤ 10, Premium owner) — **never run live**; existing logins must reconnect once for the new permissions |
| **Album-art accent colour** and **typing locked while driving** (search is replaced by a notice above 8 km/h; "I'm a passenger" lifts it; both in Settings → Music) | ✅ browser-tested · the lock only engages when the car reports a live speed |
| **TIDAL** | ✅ Client Credentials catalog/search + official embedded playback, with optional account OAuth/PKCE; configure a TIDAL Developer Client ID + Client Secret in Settings |
| **YouTube Music** — integrated search, public playlists, queue and in-dash playback using the official YouTube APIs | ✅ added as a **Music** tab; regular YouTube removed — [docs/youtube.md](docs/youtube.md) |
| **OBD-II vehicle data** — live gauges, trip computer, check-engine alert, **fault codes** (read/clear), "car off" / "adapter lost" states, never shows stale or invented values | ✅ tested against a fake ELM327 and a real serial device · ⚠️ **not yet run on a real car or Bluetooth adapter**; classic-Bluetooth/Wi-Fi/USB adapters only (no BLE) — [docs/obd.md](docs/obd.md) |
| **Sound output picker** (e.g. choose your RCA audio HAT) | ✅ UI + tested against sample `pw-dump` output · ⚠️ not tested on a real Pi |
| **Android Auto** — native wired USB receiver integration; detects phone USB vendors and launches an optional LIVI ARM64 AppImage on demand | ⚠️ USB detection + launcher implemented; LIVI video/touch/audio must be verified on the real Pi/phone. No ADB or phone hotspot — [docs/android-auto.md](docs/android-auto.md) |
| Bluetooth calls, GPS/maps, FM/DAB | ❌ not started — see [docs/ideas.md](docs/ideas.md) for the full list with what each needs |
| Runs on the Pi 5 | ⚠️ **untested on hardware** — [docs/pi-setup.md](docs/pi-setup.md) |

## Try it on Windows

Requires [Node.js](https://nodejs.org) **22.9 or newer**.


```sh
git clone <this repo> && cd RPI-head-unit
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. In development the app is shown inside a
**preview frame** at an exact car-screen resolution (800×480, 1024×600, 1280×720,
1280×400, or *Fit window*) so you can judge real-size layout — pick your panel's
size from the bar at the top.

* Tap the ✎ pencil to **edit the dashboard**. Drag a widget to move it, drag the
  corner to resize it, ⚙ configures a widget, ✕ removes it, **+ Widget** adds one,
  and the **+** tab adds a page (tap the active page's name to rename/delete it).
* Layout and settings persist in `data/` (git-ignored).

Other commands:

```sh
npm test            # server + UI unit tests
npm run typecheck   # all three packages
npm run build       # production build (UI → apps/ui/dist, server → apps/server/dist)
npm start           # serve the built UI + backend on http://127.0.0.1:8787
npm run android-auto:install  # Pi 5: install verified native wired USB Android Auto receiver (LIVI)
```

Copy `.env.example` to `.env` to configure Spotify, the projection command, etc.

## How it's built

```
packages/shared   TypeScript types + validation shared by UI and server (the WebSocket protocol,
                  settings, dashboard layout, default layout)
apps/server       Node backend: WebSocket hub, JSON persistence, providers for vehicle / media /
                  system (volume, brightness) / projection (Android Auto)
apps/ui           React + Vite + zustand. react-grid-layout for the dashboard
deploy/           systemd unit + Chromium kiosk launcher for the Pi
docs/             Pi setup, Spotify, TIDAL, Android Auto, OBD, radio, screenshots
```

The server owns the truth and pushes state over one WebSocket (`/ws`); the UI sends
commands back. Runtime providers are hardware/service backed only: OBD-II for vehicle data,
BlueZ for phones, PipeWire/brightnessctl for system controls, and native external projection
for Android Auto. Missing hardware is reported as unavailable instead of being simulated.

| Provider | Runtime source |
| --- | --- |
| Vehicle | OBD-II / ELM327 |
| Devices | BlueZ |
| System | PipeWire `wpctl` + `brightnessctl` |
| Music | Spotify / TIDAL |
| Projection | external Android Auto receiver |
| Radio | internet streams |

### Adding a widget

1. Write a component under `apps/ui/src/widgets/`. Read state with
   `useHeadUnit(s => s.vehicle)` (or `media`, `system`, `settings`). Size text with
   container-query units (`cqh`, `cqmin`) so it fits any grid cell.
2. Register it in `apps/ui/src/widgets/registry.tsx` with its name, icon, default and
   minimum size (in grid cells; the grid is 12 × 6) and optional config fields.
3. It appears in **+ Widget** automatically.

### Security note

The backend binds to `127.0.0.1` and rejects requests whose `Host` or `Origin` isn't
loopback (DNS-rebinding / cross-site protection), because it can change volume and
settings and holds your Spotify token. See `.env.example` before exposing it.

## Design constraints worth knowing

* **Touch first:** every target ≥ 44 px, nothing depends on hover.
* **Pi touchscreen scrolling:** kiosk mode explicitly enables Chromium touch events; vertical panels use native `pan-y` scrolling and tab strips use `pan-x`.
* **Offline:** no web fonts, CDNs or external requests.
* **Pi-friendly rendering:** no blur/backdrop filters; gauges are SVG with cheap strokes.
* react-grid-layout 2.2 has a touch bug (reads `e.clientX`, undefined on touch events)
  and a misleadingly-named `noOverlapCompactor` (it *allows* overlap) — both are worked
  around and commented in `apps/ui/src/pages/Dashboard.tsx`.

## In-place updates and rollback (Raspberry Pi)

Version 0.2.0 added **Settings → Software update**. Run `sudo ./install.sh` for this release once to install the protected updater helper. After that you normally do **not** need to fresh-install future releases:

1. Open **Settings → Software update**.
2. Tap **Choose ZIP** and select a newer RPI Head Unit `.zip` package.
3. Tap **Install update**. The Pi stages the package, runs `npm ci` and a production build, then saves the currently installed version as a rollback point before switching.
4. The head-unit service restarts automatically.

The updater preserves `.env`, the `data/` directory (settings, credentials and wallpapers), and the existing system/Android Auto configuration. Up to three normal rollback points are retained. If a release causes trouble, tap **Rollback** and tap it a second time to confirm.

Version 0.2.1 also provisions the Pi's **RPI Headunit** Spotify Connect receiver during the normal staged build, so it can be delivered through Settings → Software update without a fresh install. Version 0.2.2 replaces the TIDAL iframe with a native TIDAL player UI (search, queue, artwork, seek, transport and volume controls) backed by TIDAL's Web Player SDK. Version 0.2.3 tightens the native TIDAL layout for short touch displays: artwork can no longer shrink out of its flex slot, the search slab is replaced by a compact field, and TIDAL panels are more opaque so album-art backdrops do not interfere with controls. Version 0.2.4 adds the easy updater: download a new RPI Head Unit ZIP on the Pi and Settings detects it automatically so it can be installed with one tap, while manual ZIP install and rollback remain available. The update helper is root-owned and accepts update ZIPs only from the head unit's private update inbox. Archives with unsafe paths, symlinks, excessive file counts, or excessive expanded size are rejected before installation. Version 0.2.7 added the Developer Head Unit Server bridge. Version 0.2.8 fixes Pi data-directory ownership so Spotify Connect cannot prevent the backend from starting, and makes Spotify cache errors non-fatal. Version 0.3.8 changes the Android Auto developer transport to **phone-hotspot ADB Wi-Fi first**: pair Android Wireless debugging once in the UI, then the Pi remembers/reconnects the phone and forwards Head Unit Server port 5277 automatically. USB ADB remains a fallback. The normal installer disables Pi `hostapd`/OpenAuto AP services so `wlan0` stays on the phone hotspot.


## Easy update on Raspberry Pi

From v0.2.4, download a new `RPI-head-unit-*.zip` directly on the Pi. Open **Settings → Software update**, tap **Check Downloads**, then **Install**. The existing manual ZIP picker and rollback remain available.

### Raspberry Pi touchscreen

The Pi kiosk now forces native labwc touchscreen events (`mouseEmulation="no"`) so one-finger scrolling reaches Chromium. It also includes an in-app on-screen keyboard that appears automatically when a text/search/password field is focused in kiosk mode. A mouse-drag scrolling fallback remains active for unusual touch controllers that still present as mouse devices.

## Touch keyboard on Spotify / Google sign-in pages

Pi kiosk builds load `deploy/chromium-touch-companion/` as a local unpacked Chromium extension. The normal React keyboard only exists while the head-unit page itself is loaded, so the companion supplies the same touchscreen typing workflow when OAuth or another external `http(s)` page replaces the app. It runs locally, does not log or transmit typed keys, and is skipped on the head-unit's own `127.0.0.1:8787` page.

External pages also show a small Back button in the upper-left corner. A swipe from the left edge toward the right performs browser Back; if an external page was opened without history, it returns to `http://127.0.0.1:8787/?kiosk=1`. Inside the native head-unit UI, non-home pages have a Back arrow in the top bar and use the same left-edge gesture.

## v0.3.4 — Universal media + USB knob + Bluetooth HQ

- Home **Now Playing** follows the source that is actually playing: Spotify, native TIDAL, YouTube Music, radio, or Bluetooth phone audio.
- Generic USB multimedia/volume knobs remain native for Volume +/- and Mute. Track/arrow events become context-aware: rotate through visible Search/Library/queue rows, press to open/play the highlighted item, and use previous/next/play-pause when no browse row is selected.
- Bluetooth phone audio uses PipeWire/WirePlumber A2DP sink mode, negotiates the best mutually supported codec (LDAC/aptX HD/aptX/AAC/SBC-XQ/SBC), exposes AVRCP metadata/controls, and routes phone audio to the selected head-unit output.
- Bluetooth cover art is best-effort: AVRCP supplies title/artist/album, then the backend looks up matching catalog art without making playback depend on that lookup.
- Native TIDAL requests the highest Wi-Fi audio tier the signed-in account/app/track is allowed to use, falling back safely when that entitlement is unavailable.

Because this release installs PipeWire Bluetooth packages, WirePlumber policy and input-device service permissions, install v0.3.4 once with `sudo ./install.sh`. Later app-only updates can return to Settings -> Software update.

## Spotify playback on Raspberry Pi

v0.3.5 uses a dual Spotify path:

- **Primary:** native `librespot` Spotify Connect receiver named **RPI Headunit**, requested at **320 kbps**.
- **Fallback:** Spotify's official Web Playback SDK, started only when you explicitly choose **Browser fallback**.

The native receiver is downloaded from the upstream Raspotify ARM64 package during a Pi build/update, so the Pi needs internet access while applying this version. Spotify Premium is required by both playback paths. Native librespot does not provide Spotify Lossless; the 320 kbps path is the highest standard-quality mode exposed by librespot.


## v0.3.7 — kiosk keyring/autostart fix

The Pi kiosk now uses a dedicated Chromium profile at `~/.config/rpi-headunit-chromium`
with `--password-store=basic`. The installer also removes stale RPI Head Unit kiosk
launch lines left by older versioned Downloads folders before adding the current one.
This prevents an older Chromium process from winning the startup race and triggering
the GNOME `Unlock Keyring` dialog. Existing unrelated labwc autostart entries are kept.

## v0.3.5 — Spotify native 320 kbps + browser fallback

- Native `librespot` is again the primary `RPI Headunit` Spotify Connect receiver on Raspberry Pi.
- The Pi build/update fetches the current ARM64 receiver from the upstream Raspotify package.
- Native playback requests Spotify's 320 kbps stream and leaves loudness normalisation off by default.
- The official Spotify Web Playback SDK is lazy-started only when **Browser fallback** is chosen.
- **Play on…** shows the native receiver state, requested bitrate, active path, restart control, and the browser fallback separately.
- Old v0.3.3/v0.3.4 `.env` files containing `SPOTIFY_CONNECT_ENABLED=0` no longer silently disable the new native-first path. Set `SPOTIFY_CONNECT_DISABLED=1` only if you intentionally want it off.
- Spotify Premium is required. Librespot's 320 kbps path is not Spotify Lossless.


### v0.4.1 kiosk startup recovery
The kiosk no longer blocks on an HTTP fetch of the UI HTML before Chromium starts. `deploy/diagnose-display.sh` also uses request timeouts so diagnostics cannot freeze at `ui html`.


## v0.4.2 kiosk recovery

This build fixes a Raspberry Pi failure where `/api/health` responded but the root UI request `/` never returned, leaving Chromium as `Untitled - Chromium`. The production server now serves the local UI build through a deterministic synchronous static-file path and exposes `/api/ui-health` for diagnostics.
