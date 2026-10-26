# 3D Glass Motion Studio — Head Unit v2.3.0

The new Home, Music and Settings effects are part of the **real web UI source code**, implemented with CSS animations and 3D transforms. No mock images, network texture downloads, WebGL engine, or secondary graphics process is required. The interface does **not** change audio processing or the FM transmitter functionality.

## Controls

In the head unit open **Settings → Appearance → Customise → Effects**. Changes are applied and saved through the existing settings API.

- **3D music artwork**: Classic, Spinning vinyl, Floating 3D, Hologram, Glass 3D, Orbit ring, Prism shift. Used on Now Playing, the Home music widget and, since v2.8.9, the Spotify, TIDAL and Radio players on the Music page. When audio stops, the album animation stops. The Now Playing screen also has a quick mode-cycle button.
- **3D interface depth** also gives the Music page panels the same Soft/Deep/Crystal shadows as Home's widgets.
- **3D interface depth**: Flat, Soft 3D, Deep 3D, Crystal glass. Crystal adds edges, layering, reflection and refraction effects without moving the widget grid.
- **Background animation**: Off, Ambient glow, 3D orbit rings, Perspective laser grid. Rendered **behind** the Home widgets and, since v2.8.9, behind the Music players (Spotify, TIDAL, YouTube Music, Radio) and Now Playing; never on top of buttons. (It was called *Home dashboard animation* before v2.8.9.)
- **3D glass finish**: Clear glass, Frosted glass, Prismatic edges. Available independently of the motion setting. Use with Style → Glass for the strongest effect.
- **Animation speed**: Off, Calm, Cinematic. Off disables decorative animation but keeps the static glass treatment.
- **16 appearance presets**: Cyber Neon, Ocean Glass, Vinyl Lounge, Aurora 3D, Night Racer, AMOLED Eclipse, Sunset GT, Focus HUD, Crystal Palace, Liquid Chrome, Emerald Matrix, Galaxy Purple, Arctic Ice, Ruby Glass, Copper Retro, Hyperdrive.

Presets are combinations of existing color palettes, backgrounds, surfaces, and new 3D controls. Users can customize every parameter afterward.

## Hardware and safety

- Animations are CSS based and run on the graphics compositor. No WebGL/Three.js dependency and no additional hardware.
- A moving car automatically hides the Home background scene and stops the animated glass/album choreography (with the earlier slow-vinyl exception). The Home dashboard does not move the actual widget boxes: drag/resize hit-testing remains in the original grid coordinates.
- OS `prefers-reduced-motion` disables decorative motion. Selecting Effects → Minimal removes the animated dashboard scene. Motion → Off disables animation as well.
- On Raspberry Pi 5, start with **Effects → Balanced**, **Motion → Calm**, **Dashboard → Ambient glow**, and **Glass → Frosted**. Use **Cinematic / Orbit / Crystal** only if graphics performance is acceptable in your setup.
- Screenshots of an older version do not verify these effects. Test this new UI on the actual Pi 5 after installation.

## Verifying this release

This ZIP contains the v2.3.0 source project, not a precompiled `dist` folder. The head unit updater must install dependencies and build the UI on its target system. The shared settings typecheck and a round-trip test of all 1,008 combinations of the five 3D settings were successful during packaging. The full UI build was **not** possible in the packaging environment because npm package downloads failed (DNS error). Always make a backup and retain a rollback copy.

## FM transmitter

The existing **Apps → FM transmitter** implementation and all its source files are retained without changes. See [fm.md](fm.md) for the supported second-Pi FM helper and safety notes. **Raspberry Pi 5 cannot use `fm_transmitter`'s GPIO FM technique directly.**
