# Raspberry Pi 5 setup

> **Untested on hardware.** Everything here was assembled without access to a Pi.
> The app itself is verified (build, tests, browser runs); the OS-level steps
> below follow standard Raspberry Pi OS practice but expect to adjust them.

## 1. OS

Raspberry Pi OS **64-bit, Trixie / Debian 13 recommended** (Wayland/labwc desktop). The head-unit web app can run on Bookworm, but the native Pi 5 wireless Android Auto receiver used by this project requires Trixie for its OpenGL ES 3.x path. Enable auto-login to the desktop with `raspi-config`.

## 2. Node 22+

The backend needs Node **≥ 22.9**. Bookworm's apt version is older; install Node 22
from NodeSource or with `nvm`, then confirm `node --version`.

## 3. Install and build

```sh
git clone <this repo> ~/rpi-head-unit && cd ~/rpi-head-unit
npm install
cp .env.example .env      # edit as needed
npm run build
```

## 4. Backend as a service

```sh
sudo cp deploy/headunit.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now headunit
curl http://127.0.0.1:8787/api/health    # → {"ok":true}
```

Edit `User=`, the paths and `XDG_RUNTIME_DIR` in the unit if you're not user `pi`
(uid 1000). Volume control uses `wpctl` and needs that user's PipeWire session. The unit
runs `/usr/bin/node` (where NodeSource puts it); if you installed Node with `nvm`, put the
absolute path printed by `which node` into `ExecStart=` instead.

### Network access (`HOST`): there is no login

Out of the box the backend listens on `127.0.0.1` only, so the only thing that can talk to it
is the kiosk browser on the Pi itself. That is the supported setup.

If you set `HOST=0.0.0.0` (or the Pi's address on some network) in `.env`, the HTTP API and
the WebSocket become reachable from that network, and **they have no authentication**. The
only checks are on the `Host` and `Origin` headers (`HEADUNIT_ALLOWED_HOSTS` lists the extra
names you want to allow). Those stop a *web page in someone's browser* from reaching the
head unit, but not a program: `curl` or a script that sends an allowed `Host` header and no
`Origin` is accepted. Anyone who can reach the port can therefore, for example:

* replace the saved Spotify/TIDAL Client ID and secret, or sign the account out
  (`/api/connections`),
* show or stop Android Auto and the reverse-camera overlay (`/api/projection`, `/api/camera`),
* change volume, brightness, settings and layout, and control playback, over `/ws`,
* send OBD diagnostics commands, including **clearing the car's stored fault codes**.

When that is acceptable: a private network only you control and trust (a home bench setup, a
wired link to your laptop) and a Pi you do not drive around with. It is **not** acceptable on a
shared or public Wi-Fi, a phone hotspot other people can join, or behind a port forward.
Two cautions specific to this project:

* **Wireless Android Auto creates a Wi-Fi access point on the Pi** (see
  [android-auto.md](android-auto.md)), and OpenAuto Prodigy's default password for it is `12345678`.
  `HOST=0.0.0.0` listens on that interface too, so anyone who joins it reaches the API. Change
  that password, and prefer binding `HOST` to the one address you need (for example the
  Ethernet address) instead of `0.0.0.0`.
* A name used in the browser's address bar must be listed in `HEADUNIT_ALLOWED_HOSTS` or the
  request is answered with 403 `bad host`.

If you only need to look at the UI from your laptop, you do not need `HOST` at all: keep the
default and use an SSH tunnel, `ssh -L 8787:127.0.0.1:8787 pi@car.local`, then open
`http://127.0.0.1:8787` on the laptop.

## 5. Kiosk browser on boot

Add to `~/.config/labwc/autostart`:

```sh
/home/pi/rpi-head-unit/deploy/kiosk.sh &
```

The script waits for the backend, then starts fullscreen Chromium on
`http://127.0.0.1:8787/?kiosk=1` (`?kiosk` hides the cursor and disables the
long-press context menu).

## 6. Display

* **Resolution:** the UI adapts to any size; it's been checked at 800×480,
  1024×600 and 1280×720 (use the preview bar on Windows to see your panel's exact
  size). Set the real resolution in Raspberry Pi OS display settings.
* **Touch:** most USB/HDMI touch panels work out of the box. If taps land in the
  wrong place on a rotated panel, calibrate/rotate in the OS (libinput).
* **Brightness:** if the panel exposes `/sys/class/backlight` (e.g. the official
  DSI display) the backend drives it with `brightnessctl`
  (`sudo apt install brightnessctl`; add your user to the `video` group). HDMI/USB
  panels usually have no backlight node, so the UI dims in software instead — the
  Settings page says which mode you're in.

## 7. Audio (RCA HAT) / Spotify

**An audio HAT with RCA outputs** is a good fit: it gives line-level stereo for an amplifier
(it doesn't drive speakers by itself).

1. **Enable the HAT.** Most are enabled with a device-tree overlay in `/boot/firmware/config.txt`
   — use the one from your HAT maker's documentation, e.g. `dtoverlay=hifiberry-dacplus`,
   `dtoverlay=iqaudio-dacplus` or `dtoverlay=justboom-dac` — and usually turn the Pi's own audio
   off with `dtparam=audio=off`. Reboot, then check it appears: `aplay -l`.
2. **Choose it in the app:** *Settings → Display & sound → Sound output* lists every output
   PipeWire sees (the HAT, HDMI, Bluetooth speakers…) and sets the default with one tap. Volume
   then controls whichever output is selected. (This reads `pw-dump` and uses `wpctl set-default`;
   it's tested against sample `pw-dump` output, **not on a real Pi**.)
3. If the HAT never shows up in the list, it isn't enabled at the OS level (step 1) — the app
   can only choose between outputs the system already has.

See [spotify.md](spotify.md) for raspotify, which also plays through the default output.

## 8. Wired USB Android Auto

Plug the phone into a Pi USB-A port with a data cable. The head unit needs a separate native wired Android Auto receiver; USB detection alone is not projection. To install the optional verified LIVI ARM64 AppImage **as the normal Pi desktop user, without sudo**:

```sh
npm run android-auto:install
sudo systemctl restart headunit.service
```

This no longer installs wireless-only OpenAuto Prodigy. No phone developer Head Unit Server, ADB or phone hotspot is required. See [android-auto.md](android-auto.md).

## 9. Bluetooth phones, OBD-II, camera, radio

* **Pair phones** in the OS Bluetooth settings (or `bluetoothctl`: `scan on`, `pair`, `trust`,
  `connect`). They then appear on the **Devices** page. Battery shows only if BlueZ exposes a
  battery level for that phone (`bluetoothctl info <address>` shows "Battery Percentage" when it
  does); many phones don't, and the UI shows "—" rather than a guess. Signal and carrier aren't
  available over Bluetooth alone. This adapter is parsed/tested against fixtures but **has not run
  against real BlueZ**.
* **OBD-II:** pairing, binding the adapter to `/dev/rfcomm0` and the settings are in [obd.md](obd.md).
* **Reverse camera:** a USB camera/UVC capture dongle for an analog camera shows up as a video
  device (`v4l2-ctl --list-devices`); the browser opens the first one. See `docs/ideas.md` for the
  reverse-light GPIO trigger.
* **Text entry** (radio search, renaming pages) needs an on-screen keyboard for a touch-only
  panel, e.g. `squeekboard` or `onboard`.
* **Radio:** internet radio needs an internet link; over-the-air radio needs a tuner — `docs/radio.md`.

## 10. Power (important in a car)

* Use a proper automotive **12 V → 5 V/5 A USB-C** supply for the Pi 5.
* A hard power cut on ignition-off can corrupt the SD card. Use a UPS/ignition
  -sense HAT or a supercap board that triggers `shutdown`, or boot from a quality
  SSD and mount the root filesystem read-only. This isn't implemented in the app.

## Performance tips

Blur is the expensive thing on the Pi's GPU, so the UI keeps to a budget (the policy is written
at the top of `apps/ui/src/styles.css`, and [themes.md](themes.md) describes the appearance
settings): at most **one** blur layer on screen (the backdrop's own filter), `backdrop-filter`
only with *Effects: full* on the glass surface and only on the widget, sheet and rail
containers, no large shadows, and only opacity and transform are animated. *Effects: minimal*
turns blur and decorative animation off altogether. If you add custom widgets, stay inside that budget and
prefer CSS transitions to JavaScript animation.
