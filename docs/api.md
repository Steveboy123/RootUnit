# API

Everything the screen does goes through this API, so you can script it (a reverse-light GPIO, a home-automation button, an ESP32
sensor). It is served on `http://127.0.0.1:8787` and **has no login**: it listens on loopback only, and every request whose `Host`
is not loopback, or that changes something with a foreign `Origin`, is refused (this stops web pages and DNS rebinding, not other
devices — read "Network access" in [pi-setup.md](pi-setup.md) before exposing it).

Errors are `{ "error": "plain-language message" }` with a 4xx/5xx status. Values out of range are **refused**, not clamped.

## Live state (WebSocket `/ws`)

The first message is a snapshot (`settings`, `layout`, `vehicle`, `media`, `system`, `devices`, `projection`, `radio`, `svc`, `demo`).
After that, changes arrive as small messages. The services channel carries named states:

| `svc` name | Contents |
| --- | --- |
| `gps` | fix, position, speed, heading, altitude, accuracy, satellites, trip km and top speed, parked spot |
| `health` | Pi temperature, load, memory, storage, uptime, decoded `vcgencmd get_throttled` flags |
| `trips` | the trip in progress, recent trips, totals (today, week, month, all), the last 14 days |
| `garage` | vehicle, fuel log and economy, services, documents, and everything due (most urgent first) |
| `weather` | status (`off`, `no-location`, `loading`, `ok`, `error`), place, now, next days |
| `timers` | running countdowns, parking meters and the sleep timer (as end times) |
| `scenes` | the saved scenes |
| `actions` | the quick actions, **without their addresses** |
| `lighting` | WLED connection, power, brightness, colour, mode, effects |
| `dashcam` | recording state, cameras, clips, saved events |

## Navigation, Apps screen and Quick Panel settings

Three settings keys hold how the screen is arranged. They travel in the snapshot with everything else, are changed with the same
WebSocket message as any setting, `{ "t": "settings", "patch": { ... } }`, and are part of a backup. (Plain-language guide:
[navigation.md](navigation.md).)

| Key | Shape |
| --- | --- |
| `nav` | `{ version: 1, position: "left" \| "right", size: "compact" \| "regular" \| "large", labels: "always" \| "active" \| "never", items: NavItem[] }` |
| `launcher` | `{ version: 1, hidden: string[] }`: app ids kept off the Apps screen (at most 16) |
| `panel` | `{ version: 1, tiles: ("camera" \| "standby" \| "passenger" \| "lights" \| "aa" \| "phones" \| "bt")[], sections: { scenes, actions, sleep: boolean } }` |

A `NavItem` is `{ id, to, label?, icon? }`. `to` is one of `{kind:"route", route:"home"|"drive"|"media"|"aa"|"apps"|"settings"}`,
`{kind:"app", app}`, `{kind:"music", tab:"spotify"|"tidal"|"youtube-music"|"radio"}`, `{kind:"scene", scene}`,
`{kind:"action", action}` or `{kind:"gap"}` (the divider). `label` is at most 10 characters; `icon` is one of 42 names (see
`NAV_ICONS` in `packages/shared/src/nav.ts`). The list is always `[...scrolling buttons, divider, ...pinned (at most 2), settings]`,
at most 10 entries in all, and **Settings is always last**.

How a patch is read (all of it is the same code on the server, on the screen and when a backup is restored):

* A patch may carry any of `position`, `size`, `labels`, `items`; each replaces the stored one whole. A patch without `version: 1`
  is ignored. A part that is not valid is ignored, never half-applied.
* The result is rebuilt from scratch: unknown fields are dropped, ids are made unique, Settings and the divider are put back where
  they belong, labels are cleaned (invisible and look-alike-blank characters removed, cut to 10 characters). Doing it twice gives the
  same answer, and nothing that arrives can make it throw.
* An `items` list with nothing usable in it keeps the rail as it was (it is damage, not an intention).
* When the server had to change what a screen sent, it answers that screen with `{ "t": "settings", "data": <settings> }` so both
  agree. Frames over 256 KiB are refused.
* A backup made before these keys existed has none of them; restoring it keeps the ones the head unit already has.

## Garage

| Route | |
| --- | --- |
| `GET /api/garage` | the whole state |
| `PUT /api/garage/vehicle` | name, plate, fuel type, tank size, odometer |
| `POST /api/garage/fuel` · `PUT/DELETE /api/garage/fuel/:id` | fuel-ups: `date` (YYYY-MM-DD), `odometerKm`, `liters`, `cost`, `full`, `note` |
| `POST /api/garage/services` · `PUT/DELETE /api/garage/services/:id` | reminders: `name`, `everyKm` and/or `everyMonths`, last done |
| `POST /api/garage/services/:id/done` | mark done now (today's date, current odometer) |
| `POST /api/garage/docs` · `PUT/DELETE /api/garage/docs/:id` | documents with an expiry date |

## Trips, GPS

| Route | |
| --- | --- |
| `GET /api/trips` · `GET /api/trips.csv` | state; every trip as CSV (formula characters neutralised) |
| `DELETE /api/trips?confirm=1` · `DELETE /api/trips/:id` | clear all (needs the confirm); delete one |
| `GET /api/gps/state` · `GET /api/gps/track.json` | live GPS; the recorded breadcrumb of this trip (up to 2000 points) |
| `GET /api/gps/track.gpx` · `GET /api/gps/track.csv` | the track as a download |
| `POST /api/gps/action` | `{ "action": "reset-trip" \| "park" \| "clear-park" }` |

## Weather, timers, scenes, actions, notes

| Route | |
| --- | --- |
| `GET /api/weather` · `POST /api/weather/refresh` | state; fetch now |
| `GET /api/weather/places?q=` · `PUT/DELETE /api/weather/place` | search places; pin a place or go back to GPS |
| `POST /api/timers` · `DELETE /api/timers/:id` | `{ "seconds": 600, "kind": "timer" \| "parking" \| "sleep", "label": "…" }` (5 s to 24 h) |
| `GET/POST /api/scenes` · `PUT/DELETE /api/scenes/:id` | look, brightness, volume, lights, page to open |
| `GET/PUT /api/actions/config` · `POST /api/actions/:id/run` | the full definitions; run one. Only private-network addresses unless `allowInternet` is set; no redirects; link-local never |
| `GET/POST /api/notes` · `PUT/DELETE /api/notes/:id` | notes and lists |
| `GET /api/lyrics?title=&artist=&album=&duration=` | synced lyrics; refused unless lyrics are switched on in Settings |

## Backup

| Route | |
| --- | --- |
| `GET /api/backup` | downloads `headunit-backup-YYYYMMDD-HHMM.json`: settings, layout, garage, trips, notes, scenes, radio stations. Never credentials or action addresses |
| `GET /api/backup/available` | backup files waiting in the Downloads folder, newest first |
| `POST /api/backup/restore` | `{ "file": "headunit-backup-….json" }` from Downloads, or `{ "bundle": {…} }`; answers which parts were restored and which were skipped, and why |

## Hardware (Car Lab)

| Route | |
| --- | --- |
| `GET /api/lighting/state` · `POST /api/lighting/update` | WLED: `host` (private IPv4), `enabled`, `brightness` 1–255, `color` `#rrggbb`, `mode` (`manual`, `esp-audio`, `pi-audio`), `effect`, `preset` |
| `GET /api/dashcam/state` · `POST /api/dashcam/action` | `{ "action": "start" \| "stop" \| "protect" \| "config", … }` |
| `POST /api/security/event` | from a separately powered ESP32 sensor. Header `x-headunit-sensor-token` must equal `HEADUNIT_SENSOR_TOKEN`; body `{ "kind": "motion" \| "impact" \| "door" \| "alarm" \| "manual" }` |
| `POST /api/camera/show` · `POST /api/camera/hide` | the reverse-camera overlay (for a reverse-light GPIO) |

The older routes (music, library, radio, devices, Wi-Fi/Bluetooth, update, Spotify and TIDAL sign-in) are unchanged from v0.5.0 and are
described in the documents for each.
