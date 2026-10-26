# Head Unit mascot studio (v2.5)

This upgrade adds the uploaded cyberpunk plague-doctor mascot to the **actual application interface**. It is **not** a static wallpaper, and can coexist with every background, album-art choice, theme, glass style and reactive overlay.

## Controls

Go to **Settings → Appearance → Customise → Mascot**. Options: Show/hide, Original (dark background), Transparent neon cutout, 3D-style armored cutout; display on Home or all pages; behind/in front of widgets; horizontal/vertical position 0–100%; width relative to dashboard 10–95%; opacity 0–100%; neon glow 0–100%; mirror; Still / Floating 3D / Hologram / Slow 3D Tilt; and music-beat glow.

**Direct placement:** Open Home, enable the existing dashboard Edit mode, then touch and drag the mascot. The new position is saved to the server when released. Dragging the mascot does **not** move or resize dashboard widgets. Outside Edit mode the mascot never intercepts touch input, including when displayed in front of a control.

**Music reaction:** Turn on a mode in Effects → Music-reactive background, set up a system audio capture / ALSA loopback or explicit microphone permission as described in `docs/music-reactive.md`, then enable *React to the music beat* under Mascot. The glow follows real sampled audio only; with no meter it stays quiet. The background's own beat effects remain independently selectable.

**Hardware / safety:** Animations use GPU-friendly CSS 2.5D transforms, not a true 3D mesh. They pause while driving, when Effects is Minimal, Motion is Off or the device requests reduced motion. The still cutout always remains an option. Default size/opacity keep it behind widgets. Settings are persisted with the rest of the head unit configuration and will survive reboot.

**Offline assets:** `/mascot/original.webp`, `/mascot/transparent.webp`, `/mascot/armored.webp`; all shipped in the UI public directory. Original retains the black backdrop; the two alternate cutouts contain true alpha transparency. No remote image host required.

To revert, open Mascot → Reset mascot or Show mascot = Off. The Appearance Reset option also restores mascot defaults.
