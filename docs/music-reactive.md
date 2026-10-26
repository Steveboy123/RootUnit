# Music-reactive backgrounds • v2.4.0

The **background** and the **beat overlay** are TWO INDEPENDENT controls. Choose a background under Settings → Appearance → Customise → Background; choose the music reaction under Effects.

## Background options

- None / standard palette; album blur; sharp album artwork; ambient colours sampled from album art
- Aurora, gradient, grid and weave
- Built-in wallpapers; your own wallpapers uploaded from the head-unit browser or from a phone connected to the same local UI
- Blur (for album blur), dim, and transparent glass panel settings remain separate

Use **Add your own picture** under the Wallpaper picker. The upload uses a limited same-origin `/api/wallpapers/upload` endpoint; only actual PNG/JPEG/WebP/AVIF image files up to 12 MiB are accepted, and existing files are never overwritten. Uploaded files are stored under the existing `data/wallpapers` directory, retained on updates. No cloud account is required.

## Reaction options

- **Off** — keep any chosen backdrop with no music pulse (default)
- **Bass glow** — soft light spreading around the middle and edges
- **Colour wash** — colour illuminates the existing backdrop
- **3D beat rings** — perspective rings throb on detected bass transients
- **Spectrum bars** — decorative bars responding to the real loudness/bass meter (not a true 15-band FFT)

Colour: theme accent, album cover dominant colour, cycling rainbow, or a picked custom colour. Strength 0–100%; sensitivity 0–100%. This is a visual overlay underneath the widgets and controls, not a replacement for any background, and will never intercept a touchscreen touch.

## Making it respond to REAL audio

Spotify and TIDAL APIs provide playback metadata and controls, **not raw audio samples or beats**. So this feature does not pretend that song changes or a timer equal the music beat. Select a capture source:

### Option 1: Raspberry Pi ALSA monitor (recommended if routing the sound on the Pi)

1. `sudo apt-get install alsa-utils`
2. Arrange for a *copy* of the real playback audio to reach an ALSA **capture** device (for example through PipeWire's monitor, an ALSA loopback, or an external USB audio capture device). **Do not move your primary speaker output just to enable the lights.**
3. Find the capture device: `arecord -l`. Verify that your chosen device actually receives the playing music, not silence.
4. In the head unit's existing `.env`, add `HEADUNIT_BEAT_DEVICE=plughw:Loopback,1,0` (replace this example with your actual working device).
5. Restart the head-unit service; under Effects select **Pi audio monitor** and choose a reactive style. The status message reports whether samples are available. It returns quiet (not made-up pulses) when there is no captured sound.

The ALSA loopback only works if the playback path is mirrored to it; merely loading `snd-aloop` does not automatically capture Spotify/Bluetooth audio. When no device is configured, the head unit runs normally but the visual effect stays quiet. The meter polls its own local API at about 8 Hz, with no audio recording, cloud transmission, or audio-file storage.

### Option 2: Microphone (easy test)

Select **Microphone**, then **Start microphone**. The browser will request audio permission. A microphone picks up cabin sound/music, not isolated system music, so voices and road noise can also affect the pulse. `getUserMedia` normally requires HTTPS or localhost; it may not work when opening the Pi from a phone by plain HTTP. **Stop microphone** immediately closes the capture tracks. For privacy, the microphone must be restarted manually after a reload. It is not connected to speaker output.

## Performance & driving behaviour

- The overlay uses CSS shapes and opacity/transform changes; no WebGL, no full-screen audio waveform canvases or heavy visualizer packages.
- It disables while the car is moving above 8 km/h, and respects system Reduce Motion, Effects Minimal and Motion Off.
- Without a configured/live source, beat animations stay quiet rather than moving randomly. The chosen album art/wallpaper remains visible.
- Other audio functionality, including FM transmitter, does not need this meter and is unchanged.
