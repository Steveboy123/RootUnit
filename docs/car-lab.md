# Car Lab: GPS, lights and dashcam

The three hardware apps, under **Apps → Car Lab**: **GPS**, **Lights** and **Dashcam**. They share the live connection the rest of the
interface uses, so what they show is current on every screen (the Quick Panel's cabin-lights switch, the Drive screen's speed, the
launcher badges). None of them has been tried on the real hardware: they are tested against fakes of gpsd, WLED and ffmpeg.

## USB GPS (DFRobot TEL0137/TEL0138 and similar)

Connect GPS receiver directly by USB, preferably away from large metal objects. Run:

```bash
sudo ./deploy/setup-gps.sh
sudo systemctl restart headunit.service
cgps -s          # optional satellite test
```

If the serial port detected is another device (such as an OBD adapter), specify it explicitly:

```bash
sudo GPS_DEVICE=/dev/serial/by-id/usb-your_DFRobot_receiver ./deploy/setup-gps.sh
```

This uses Linux `gpsd` listening locally on TCP 2947, not HTTP or a paid map API. **Apps → GPS** shows speed, heading, altitude, accuracy, satellites and the trip counters, and draws the track of the trip **on a plain canvas with no map tiles**, so it works with no signal at all (north is up, with a scale bar; the line lifts the pen where recording stopped or the position jumped, instead of drawing a straight line across the gap). GPX and CSV downloads are one tap. **Find my car** keeps your parking spot. Maps and turn-by-turn navigation are not bundled.

The GPS speed is also what the speedometer, the trip recorder, the performance timers and the driving lock use when the car's own speed (OBD-II) is missing.

Version 0.5.0 never actually connected to gpsd (the socket was created but `connect()` was never called), so GPS could not have worked; this is fixed and tested against a real local socket.

## Music-reactive LEDs — ESP32

Recommended low-cost setup: original ESP32 WROOM board (not ESP8266), WLED 0.15+ audio reactive build, short WS2812B LED strip with diffuser, optional INMP441 I²S microphone, 12V→5V automotive buck regulator, fuse, and shared ground. If ESP audio mode is selected, configure WLED AudioReactive input and choose one of the available sound-reactive effects using the effects list in Lights (or directly in WLED); the head-unit also controls power, brightness and colours. Stand-alone ESP mic mode is best for all car audio inputs and does not depend on what app is playing.

Connect ESP32 to same *private* car Wi-Fi as Pi. In **Apps → Lights** enter its IPv4 address (e.g. `192.168.4.40`). The server refuses internet IPs, DNS hostnames and loopback connections for device control. Brightness, colour, mode and effects apply as you change them. The address is checked on the screen as well as the server, and the server is the one that refuses.

**Match the screen** (3.1, in the Colour panel of **Apps → Lights**): the lights take the colour the interface is drawn in, and the
album's colour while the accent follows the album art. It only works in the plain-colour mode (an effect or a music mode you chose is
left alone), waits until the colour has settled so a run of track changes sends one colour, and never sends the colour the lights
already have.

For Pi audio monitor mode, the head-unit uses `parec --device=@DEFAULT_MONITOR@` and streams WLED DRGB LED packets UDP 21324. This is experimental: configure PipeWire/PulseAudio default sink monitoring first, and only enable when audio is playing through that sink. Native HDMI/ALSA applications bypassing PipeWire are not captured. Prefer ESP microphone/line-in to react to everything.

Install LED power with a fuse, proper 12V automotive transient protection, and an appropriate 5V regulator. Never pull LED strip current from the Pi GPIO header. Keep effects dim at night.

## Front USB dashcam

Use a **UVC USB camera** initially (720p+ and wide view, good low-light performance), ideally separate from the existing reverse camera. Check device and formats:

```bash
ls -l /dev/video*
v4l2-ctl --list-devices
v4l2-ctl --list-formats-ext -d /dev/video0
```

The recorder uses ffmpeg/V4L2 at 1280×720 15fps / libx264 ultrafast. If a camera does not support those modes, edit `apps/server/src/dashcamCenter.ts` accordingly. Clips are 2-minute MKV files in `data/dashcam/clips`; files are pruned as storage exceeds the configured cap (2 GB by default). **Keep this moment** (in **Apps → Dashcam**) copies the last **finished** segment to `data/dashcam/events`; saved event clips are not part of rolling cleanup. Recording is intentionally **not** auto-enabled at boot. The app lists recent footage and saved moments but does not play clips back; copy them off the Pi to watch them. Parking mode never operates if the Pi has no power. Event processing is local to the Pi.

A CSI camera like the Pi 5 IMX219 wide-angle is inexpensive but **not supported by this V4L2 USB capture path out of the box**; libcamera/Picamera2 recording requires a separate driver backend. Use USB UVC if you want to run the included recorder without edits.

### Low-cost sensors

- ESP32 + SW-420 vibration switch for crude impact alerts. This switch is often sensitive to false positives; MPU6050 accelerometer is more useful for tuning thresholds.
- HC-SR501 PIR motion sensor (inside a cabin, but can trigger falsely from sun and heat).
- Magnetic door reed switch for definite door-open events.
- Optional 12V/ignition voltage sensor **with isolation and automotive-rated protection**; never connect vehicle 12V directly to ESP or Pi GPIO.

If ESP32 sensor firmware posts events, protect them with a strong token in `.env`:

```
HEADUNIT_SENSOR_TOKEN=replace-with-a-long-random-secret
```

The endpoint is POST `/api/security/event` with JSON `{"kind":"impact"}`, `Content-Type: application/json`, and header `x-headunit-sensor-token` containing the exact token. Valid kinds are `motion`, `impact`, `door`, `alarm`, `manual`. When parking-event recording is enabled, an event starts up to 90 seconds of recording if not currently recording. For persistent parking coverage, you **must** add an automotive-grade, ignition-aware power source with undervoltage protection, not just a USB powerbank. Avoid recording bystanders without considering local laws.

## USB Android Auto

The old phone-hotspot / Wireless-debugging / ADB tcp:5277 process is **disabled**. A cable and detected phone do not implement the Android Auto projection protocol by themselves. OpenAuto Prodigy is a **wireless-only receiver**; existing installs must not treat it as a wired USB engine. The new Android Auto page polls `/api/android-auto/usb` for attached Android phones through Linux sysfs and shows whether a native USB-capable projection receiver executable is configured.

For actual video/touch/mic/audio projection this build supports an **optional separate LIVI wired-USB receiver**. LIVI v9.3.0 is advertised with native wired USB Android Auto support on Pi 5 and is published as an arm64 AppImage. To download the verified upstream binary *without running upstream scripts that change your desktop/kiosk*:

```bash
./deploy/install-livi-wired.sh
sudo systemctl restart headunit.service
```

This script checks upstream release SHA-256 `41a64b9a36f33d7365e4e9aa3fff7ee82d5d9f7459b010636fbf5726a8701c1e`, installs it under `~/.local/opt/rpi-headunit`, registers the on-demand wrapper, and **does not take over autostart or change boot targets**. LIVI may still require its first-run USB helper access / configuration; the combined runtime has not been validated on the user's Pi. The original head-unit app's Android Auto page checks for USB phones and launches LIVI when configured. Set `PROJECTION_COMMAND` manually for another executable. USB debugging is unnecessary for genuine wired Android Auto.

## FM transmission on Pi 5

PiFM, markondej/fm_transmitter and the original rpitx clock-divider projects rely on peripherals present in Pi 0–4; Pi 5 uses RP1 and those transmitters are not demonstrated as a stable drop-in for Pi 5. For safety and RF compliance the UI reports FM transmitter **not available**; no GPIO pin is driven. If FM transmission becomes essential, use certified low-power external hardware suitable for your country's regulations.

## Other expansion candidates

- Dedicated ESP32 ignition monitor and battery-safe shutdown controller
- Time-aligned video plus GPS trip overlay
- IMU incline/G-force screen (sensor required)
- BLE TPMS tire pressure reading (depends on sensor protocol)
- Offline OSM routing packs (map distribution/license/capacity planning needed)
