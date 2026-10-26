# Ideas & roadmap

Done = built and tested in this repo. Everything else is an idea, roughly ordered by
value for the effort. "Hardware" says what you'd need to buy; "software" can be done
now.

## Done

| Idea | Notes |
| --- | --- |
| **Phones / devices** — several phones at once with battery, signal, carrier, transport (USB / Wi-Fi / Bluetooth), switch which one is in use, active phone's battery in the top bar | Inspired by [OpenAuto Prodigy](https://github.com/f-io/OpenAuto Prodigy). Data model + UI done; simulator for design. Real data: BlueZ (paired phones, Bluetooth, battery *if the phone reports it*). Signal/carrier/Wi-Fi/USB aren't available from Bluetooth — they'd come from the Android Auto app. |
| **Internet radio** with ★ presets, live now-playing text | [radio.md](radio.md) |
| **Reverse camera** — fullscreen with parking guides, mirror option; shows from the UI or from `POST /api/camera/show` | USB camera works (browser `getUserMedia`). Wire the reverse light to a GPIO — see below. |
| **Auto day/night theme** by schedule, or by the real sunrise and sunset where the car is | Computed offline from the GPS position (or the weather's place). Settings → Appearance → Palette. |
| **OBD-II** — live data, check-engine lamp, fault codes read/clear, graceful ignition-off/adapter-loss handling | [obd.md](obd.md) |
| **Music library** — recently played, top items, playlists, Liked Songs, albums, artists, search, queue, ♥ like, "Play on…" other Connect devices, shown on a provider-neutral `LibraryProvider` | [spotify.md](spotify.md). Built against Spotify's Feb-2026 dev-mode rules; not run live. |
| **Album-art accent colour** and **typing locked while driving** | Settings → Looks & layouts, and Settings → Music services. |
| **Alerts** — overheating, low/high battery voltage, low fuel, phone battery low; dismiss stays dismissed until the condition clears and returns | |

### Added in v2

| Idea | Notes |
| --- | --- |
| **Trips** recorded by themselves, 14-day chart, fuel cost, CSV; a trip survives the power being cut | OBD-II or GPS speed |
| **Garage**: fuel log and economy, service reminders by distance *or* date, documents that expire | no hardware |
| **Pi health**: temperature, load, memory, storage, under-voltage and throttling explained, in alerts | the cure for "why does it freeze" is usually the 12 V→5 V converter |
| **Find my car**, **parking meter**, **timers**, **sleep timer** | server-side, so they keep running whatever is on screen |
| **Performance timers** (0–100, quarter mile) | GPS or OBD speed, interpolated across the threshold |
| **Weather** with road-hazard alerts; **synced lyrics** | each is a switch; see the privacy table in the README |
| **Scenes**, **quick actions**, **notes** | one tap sets look, light and sound; web-hooks on your own network |
| **Backup and restore** of everything that is yours | never includes sign-ins |
| **GPS, Lights, Dashcam** rebuilt as apps on the live connection | [car-lab.md](car-lab.md) |
| **Arcade** (2048, Snake) while parked | |
| **Demo mode** | `npm run dev` simulates the whole car |

### Reverse-light trigger (sketch, untested)

```python
# gpio_reverse.py — run at boot. Wire the reverse-lamp wire through an optocoupler or a
# voltage divider to a GPIO: NEVER connect 12 V directly to a Pi pin.
from gpiozero import Button
import requests
b = Button(17, pull_up=False)
b.when_pressed  = lambda: requests.post("http://127.0.0.1:8787/api/camera/show")
b.when_released = lambda: requests.post("http://127.0.0.1:8787/api/camera/hide")
import signal; signal.pause()
```

(Chromium needs `--use-fake-ui-for-media-stream`, already in `deploy/kiosk.sh`, so the camera
opens without a permission prompt.)

## Next — software only

* **Bluetooth A2DP/AVRCP media provider** (any phone app → Pi audio + now-playing) for phone music apps and podcasts; **TIDAL follow-ups** if TIDAL opens the third-party scopes.
* **Local files / USB stick** player with the same library screens.
* **Fuel economy from OBD** (MAF / fuel-rate PIDs) so the garage's economy can be checked against the car's own figure; **BLE adapter** support; freeze-frame data with fault codes.
* **Time sync from GPS** (gpsd feeding chrony), so the clock is right even with no network.
* **Screen sleep and wake on ignition**; a brightness schedule; **multiple driver profiles**.
* **Peak-hold** on gauges; a shift light on the tachometer.
* **Notifications and phone calls** (Bluetooth HFP/MAP): a call screen with contacts, read-aloud messages.
* **Lyrics follow-ups**: a per-track timing offset when a synced file runs a little early or late.

## Ideas that are not about the car

A head unit is a screen and a speaker where you sit for a while, so some of the best uses are not driving ones. None of these is built.

* **Podcasts** by RSS, with resume position per episode (a long drive is when they get listened to).
* **Sleep sounds** (rain, white noise) on the sleep timer, for a van or a camper.
* **Focus / Pomodoro timer** and **world clocks**; a **unit and currency converter**, a **tip and split calculator**.
* **A shared shopping list** that is the Notes app, shown on the phone's browser while the car is on the home network.
* **Home control**: the quick actions already reach Home Assistant webhooks; a small status board (garage door open? lights on?) would be the next step.
* **Kids' mode**: the Arcade plus audio books, with the Drive lock and a one-tap exit.

## Hardware-dependent

* **FM/DAB+ radio** (RTL-SDR) — [radio.md](radio.md).
* **Ignition sense + safe shutdown** (UPS/supercap HAT): protects the SD card; also lets the unit sleep and wake with the car.
* **Steering-wheel controls**: CAN (PiCAN) or analog-resistance ladder via an ADC/USB adapter → key events → volume, next, voice.
* **Rotary volume knob / physical buttons** (GPIO) → `POST /api/projection/toggle`, volume, home.
* **TPMS tyre pressure** from cheap Bluetooth sensors (read BLE advertisements).
* **Dash cam** with a Pi CSI camera (needs a libcamera recording backend; the USB path is built), or a second camera for the rear.
* **Ambient light sensor** for automatic brightness.
* **LTE modem** for always-on internet radio/maps.

## Big projects

* **Navigation** with offline maps (MapLibre + OpenStreetMap tiles + Valhalla/OSRM routing). Android Auto's Google Maps covers this for now.
* **Embedding Android Auto inside the dashboard** (video + touch over the existing WebSocket) instead of a window swap, so the nav rail and a back button always stay on screen.
* **OTA updates** with rollback.
