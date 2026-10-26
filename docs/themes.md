# Themes and appearance

Open **Settings → Appearance → Customise…** (full-screen sheet; everything applies instantly, there is no Save button).
You can pick one-tap **Looks**, or mix the pieces yourself:

| Piece | Choices |
|---|---|
| **Palette** | 17 colour sets (below) |
| **Style** (surface) | Solid · Glass · Outline · Neon, plus corner shape (Sharp · Soft · Round) and glass transparency |
| **Background** | None · Album blur · Album cover · Ambient · Aurora · Gradient · Grid · Weave · Wallpaper |
| **Accent** | 8 swatches or a custom colour, or "follow the album art" |
| **Effects** | Minimal · Balanced (default) · Full |

Day/night switching still works: pick a day palette and a night palette and the times (Palette page). It changes the *palette* only; your style and background stay.

## Palettes

| Dark | | Light | |
|---|---|---|---|
| Midnight | navy ink with a cyan edge (the original) | Daylight | cool grey-blue and white |
| Carbon | neutral graphite | Sand | warm paper with terracotta |
| AMOLED | true black, hairline cards, electric blue | Mint | pale green-grey with deep teal |
| Ember | warm black with an orange glow | **High visibility** | |
| Ocean | deep teal-blue with aqua light | High contrast | pure black and white with yellow |
| Forest | deep moss green with emerald light | Sunlit | white and black with bold blue, for direct sunlight |
| Aurora | indigo night with violet and teal | | |
| Synthwave | deep violet with hot pink neon and a cyan edge | | |
| Nord | slate blue-grey polar night with frost cyan | | |
| Crimson | red-black with racing red | | |
| Mocha | warm coffee brown with rose-gold | | |
| Royal | black, brass and champagne gold | | |

## Looks

One tap sets palette + style + background + accent together (it never touches Effects, units or anything else).

Classic · Glass Night · Album Immersion · Ambient · Neon Drive · Sunset Cruise · Forest Retreat · Ocean Deep · Racing Red · Gold Standard · Daylight Clean · Paper Glass · Sun Glare · Night Shift

Each tile is a live miniature of the real combination, not a screenshot.

## Backgrounds that use the album art

*Album blur*, *Album cover* and *Ambient* use the cover of what is playing (the radio station logo while radio plays; for YouTube Music and TIDAL, the track you selected).
When nothing is playing they fall back to a gradient built from your accent colour, so the screen is never blank.

**Text stays readable by construction.** The background is darkened (or lightened on light palettes) by at least as much as the *actual* picture needs: the app measures how bright
the cover is and computes the smallest dim that keeps every text colour above its contrast target (4.5:1, 7:1 on the two high-visibility palettes). A dark cover needs little
dimming; a bright white one needs a lot. If the brightness cannot be measured (the picture could not be read), it falls back to the palette's worst-case dim, which is always safe.
The *Dim* slider only adds dimming on top of that.

On **light** palettes this means a dark photo needs a strong scrim, so art backgrounds look pale there. Dark palettes show the artwork much more vividly.

## Wallpapers (your own pictures)

*Background → Wallpaper* offers five built-in scenes (night road, city lights, mountains, dunes, waves) and any pictures you add:

* Put image files in `data/wallpapers/` (next to `settings.json`), or set `HEADUNIT_WALLPAPER_DIR` in `.env`. Create the folder yourself: the app only reads it.
* PNG, JPG/JPEG, WebP or AVIF, up to 12 MB each; the picker lists the first 100 by name. SVG and HTML are refused on purpose.
* File names: start with a letter or digit, then letters, digits, `.` `_` `-` or spaces (`My Photo.jpg` works); at most 100 characters; no `..`.
* New files appear the next time you open the picker; no restart. Around 1920×1080 is plenty: a huge original only costs memory on the Pi.
* Only real files directly inside the folder are served. Shortcuts (symlinks), sub-folders and everything else are ignored, and no request can reach outside the folder.

## Effects levels and the Raspberry Pi

The look is built to be cheap on a Pi 5:

* **Glass without per-card blur.** At *Minimal* and *Balanced*, "glass" is a translucent card over **one** already-blurred background layer. There is exactly one blur filter on screen.
* **Minimal**: no blur, no animation. Choose this if the screen ever feels slow.
* **Balanced** (default): one softly blurred background; nothing moves.
* **Full**: adds slowly drifting colour clouds and a true frosted `backdrop-filter` on the dashboard widgets, the sheets and the navigation rail. Uses more GPU.
* Only opacity and transform ever animate. Drifting stops while the page is hidden and when the system asks for reduced motion.

## For developers

* Palettes live in `apps/ui/src/lib/themes/` (`core.ts`, `groupA.ts`, `groupB.ts`, `groupC.ts`). Each palette is a full token set (`Palette` in `types.ts`); the registry applies it as CSS variables on `<html>`.
* Tests check **every** palette: all tokens present, WCAG contrast of text/dim/accent/status colours, glass and card fills over the worst-case picture, and that no palette is a recolour of another.
  To add a palette: add its id to `THEME_IDS` (`packages/shared/src/appearance.ts`), write it with `definePalette()`, and run `npm test -w @headunit/ui`. `paletteReport()` explains any failing rule.
* The surface styles are attribute-scoped CSS (`[data-surface]`, `[data-scheme]`, `[data-shape]`, `[data-effects]`) in `styles.css`, so a Settings preview tile can show any combination by carrying the same attributes.
* A policy test in `apply.test.ts` guards performance: keyframes touch only opacity/transform, no stray `filter`, `backdrop-filter` only on `.widget`/`.sheet`/`.rail` at Full + Glass, shadows ≤ 28 px blur.
* Settings keys: `theme`, `surface`, `background`, `effects`, `shape`, `bgBlur` (0–60), `bgDim` (0–90), `glassOpacity` (0–100), `wallpaper`. The server validates every value; unknown or out-of-range values are ignored or clamped.
