# Music-reactive light

The **background** and the **beat overlay** are TWO INDEPENDENT controls. Choose a background under **Settings → Background**; choose the music reaction under **Settings → Music reactive**.

## Backgrounds

Any background works with it: album art, a built-in or uploaded wallpaper, an animated scene, or none. The full list is in
[themes.md](themes.md). The light is drawn above the background and below every button, and never catches a touch.

## Reaction options

Settings → **Music reactive**:

| Style | | Style | |
| --- | --- | --- | --- |
| Off | nothing reacts (the default) | Halo | a halo round the artwork |
| Glow | the screen edges breathe | Burst | a flash on every hit |
| Wash | a colour wash on the beat | Wave | a waveform line |
| Rings | rings pulse out | Radial | a circular spectrum |
| Spectrum | bars along the bottom | Edges | light runs round the edges |

**Colour:** Accent · Album (from the cover) · Rainbow · Custom (one you choose) · Heat (blue to red with the volume).
**Intensity** and **Sensitivity** 0–100%. The mascot can pulse with the same meter (Settings → Mascot).

## Making it respond to REAL audio

Spotify and TIDAL APIs provide playback metadata and controls, **not raw audio samples or beats**. So this feature does not pretend that song changes or a timer equal the music beat. Select a capture source:

### Option 1: Raspberry Pi ALSA monitor (recommended if routing the sound on the Pi)

1. `sudo apt-get install alsa-utils`
2. Arrange for a *copy* of the real playback audio to reach an ALSA **capture** device (for example through PipeWire's monitor, an ALSA loopback, or an external USB audio capture device). **Do not move your primary speaker output just to enable the lights.**
3. Find the capture device: `arecord -l`. Verify that your chosen device actually receives the playing music, not silence.
4. In the head unit's existing `.env`, add `HEADUNIT_BEAT_DEVICE=plughw:Loopback,1,0` (replace this example with your actual working device).
5. Restart the head-unit service; in Settings → Music reactive choose a style and set **Listen to** to **Head unit sound**. The line under it says whether the monitor is listening. It returns quiet (not made-up pulses) when there is no captured sound.

The ALSA loopback only works if the playback path is mirrored to it; merely loading `snd-aloop` does not automatically capture Spotify/Bluetooth audio. When no device is configured, the head unit runs normally but the visual effect stays quiet. The meter polls its own local API at about 8 Hz, with no audio recording, cloud transmission, or audio-file storage.

### Option 2: Microphone (easy test)

Set **Listen to** to **Microphone**, then tap **Start microphone**. The browser will request audio permission. A microphone picks up cabin sound/music, not isolated system music, so voices and road noise can also affect the pulse. `getUserMedia` normally requires HTTPS or localhost; it may not work when opening the Pi from a phone by plain HTTP. **Stop** closes the capture at once. For privacy, the microphone must be restarted manually after a reload. It is not connected to speaker output.

## Performance & driving behaviour

- The overlay uses CSS shapes and opacity/transform changes; no WebGL, no full-screen audio waveform canvases or heavy visualizer packages.
- It disables while the car is moving above 8 km/h, and respects system Reduce Motion, Effects Minimal and Motion Off.
- Without a configured/live source, beat animations stay quiet rather than moving randomly. The chosen album art/wallpaper remains visible.
- Other audio functionality, including FM transmitter, does not need this meter and is unchanged.
