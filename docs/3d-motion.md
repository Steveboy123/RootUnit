# 3D effects and motion

Every effect is drawn by the real interface with CSS 3D transforms and animations. There is no WebGL, no video and no extra graphics
process, so it runs on the Pi 5's own GPU without anything else installed. None of it touches the audio or the FM transmitter.

![Settings → 3D effects](screenshots/settings-motion.jpg)

## Where to find it

| Setting | Where | Choices |
| --- | --- | --- |
| **Effects** | Settings → 3D effects | Minimal (no blur, no animation) · Balanced (one soft blur, gentle motion; the default) · Full (frosted glass and moving scenes) |
| **Motion intensity** | Settings → 3D effects | Off · Calm · Lively · Cinematic |
| **Album glow** | Settings → 3D effects | The coloured light behind the cover, on or off |
| **Background motion** | Settings → 3D effects | Freezes the wallpaper and scene when off, keeping everything else |
| **Particle effects** | Settings → 3D effects | A quick switch for the *Particles* scene |
| **Artwork style** | Settings → 3D effects, or the chips under the player on Now Playing | 15 styles (below) |
| **Page transition** | Settings → 3D effects | Instant · Fade · Slide · Rise · Zoom · Flip · Depth · Swing |
| **When you touch** | Settings → 3D effects | None · Ripple · Glow · Pop |
| **Depth** | Settings → Cards & depth | Flat · Soft · Deep · Crystal · Floating · Bevel · Layered |
| **Glass finish** | Settings → Cards & depth | Clear · Frosted · Prismatic · Iridescent · Smoked · Liquid |
| **Animated scene** | Settings → Background | 19 scenes behind the Home widgets, and how busy they are |
| **Navigation style** | Settings → Navigation → Edit navigation… → Look | 10 styles; the highlight slides between buttons and the album or mascot medallion turns |

Every featured look, signature look and 3D scene sets these together so they match (see [themes.md](themes.md)); any of them can be
changed on its own afterwards.

## Artwork styles

Used on Home, Now Playing and the Music players. The cover only moves while something plays.

| Style | | Style | |
| --- | --- | --- | --- |
| Classic | the plain cover | Compact disc | a shiny disc |
| Spinning vinyl | a record that turns while it plays | Cassette | a tape with turning reels |
| Floating 3D | the cover hovers and tilts | Parallax tilt | leans as it plays |
| Hologram | projected above a glowing ring | Stack | a pile of sleeves |
| Glass 3D | the cover behind glass | Breathe | swells with the music |
| Orbit | rings circle the cover | Polaroid | an instant photo |
| Prism | rainbow edges | Glitch | digital tears |
| | | Flip | turns over now and then |

![Now Playing with the spinning vinyl](screenshots/nowplaying.jpg)

## Safety and the Pi

* Only `transform` and `opacity` animate, so the GPU does the work and nothing is laid out again. A test (`styles/policy.test.ts`)
  fails the build if any stylesheet breaks that rule.
* **While the car moves** (above 8 km/h), the scenes, the mascot, the glass sheen and every other decorative animation stop. Only the
  turning record or CD and the music equaliser keep going, because they show that music is playing. Widgets never move.
* *Effects → Minimal*, *Motion intensity → Off* and the system's *reduce motion* setting each stop all decorative motion.
* The real frosted `backdrop-filter` is used only at *Full*; *Balanced* fakes glass over one blurred background layer.
* On a Pi 5, start with **Balanced** and **Calm**. Try **Full** and **Cinematic** once you have seen how your screen copes.

This was built and checked in a browser at 800×480, 1024×600 and 1280×400, not on a Pi. How smooth it is on the real screen is the
first thing to look at.
