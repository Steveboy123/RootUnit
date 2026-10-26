# The mascot

The cyberpunk plague-doctor mascot is part of the interface itself, not a wallpaper, so it works with every background, look, glass
style and music-reactive overlay.

## Settings → Mascot

| | |
| --- | --- |
| **Show the mascot** | on or off |
| **Artwork** | Original (dark backdrop) · Neon cut-out · 3D armour (both cut-outs are truly transparent) |
| **Movement** | Still · Float · Hologram · 3D tilt · Breathe · Glitch · Orbit · Scan · Peek · Sway · Pulse · Bounce · Drift |
| **Light** | None · Glow · Halo · Sparks · Smoke · Rings · Aurora, and how strong the glow is |
| **Pulse with the music** | follows the music-reactive meter when it is on; with no meter it stays still, never an invented beat |
| **Where it stands** | Home only or every page; behind the widgets or in front; across, up and down, size, visibility; mirror |
| **Reset the mascot** | two taps back to the defaults |

**Drag it into place:** on Home tap the pencil, then drag the mascot. It is saved when you let go, and it never moves or resizes a
widget. Outside edit mode the mascot never catches a touch, even when it is in front of a button.

## The mascot in other places

* **Home layouts and the player card.** The *Cockpit* and *Player focus* layouts put the mascot inside the player card and switch the
  separate one off, so it never shows twice. *Glass hub* places it behind the widgets in the space on the right.
* **The navigation bar.** The *Mascot* style puts it in a glowing medallion in the middle of the bar; tap it for Now Playing.
* **The standby screen** can show it (Settings → Type & gauges → Standby screen → Mascot).
* **The boot screen** has its own copy and settings: see [mascot-boot.md](mascot-boot.md).

## Safety and files

Its motion is CSS transforms, not a 3D model. It rests while you drive, when Effects is *Minimal* or motion is *Off*, and when the
system asks for less motion. The pictures ship with the app in `apps/ui/public/mascot/` (`original.webp`, `transparent.webp`,
`armored.webp`), so nothing is downloaded.
