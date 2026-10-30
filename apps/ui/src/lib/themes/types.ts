import type { ThemeId } from '@headunit/shared';

export type Scheme = 'dark' | 'light';

/**
 * Which ink goes on top of the accent colour (buttons, active pills).
 * `auto` takes whichever of dark ink / white reads better; `dark` / `light` prefer that ink as long as it reaches 4.5:1,
 * otherwise the better one is used anyway — legibility always wins over taste.
 */
export type OnAccentMode = 'auto' | 'dark' | 'light';

/**
 * One palette = every colour the interface draws with. The registry in index.ts holds one per ThemeId; apply.ts turns it into CSS
 * variables. Colours are CSS strings: `#rgb`, `#rrggbb` or `rgba(r, g, b, a)` (the parser in contrast.ts reads exactly these).
 *
 * Every field is required — a test asserts completeness for every palette, and that the contrast rules (spec §5) hold.
 */
export interface Palette {
  id: ThemeId;
  label: string;
  /** One line shown under the tile. */
  blurb: string;
  scheme: Scheme;
  /** Page background (opaque #rrggbb) and the second stop of the page gradient / rails (opaque). */
  bg: string;
  bg2: string;
  /** Fill of the navigation rail and top bar. */
  nav: string;
  /** Card fill and its pressed/raised state (may be translucent; composited over bg when measured). */
  card: string;
  cardHi: string;
  border: string;
  /** Hairline that must stay visible: outline surfaces, focus rings, separators on busy backdrops. */
  borderStrong: string;
  /** Primary text (opaque) and secondary text (opaque). */
  text: string;
  dim: string;
  /** Empty part of sliders, gauges and progress bars. */
  track: string;
  /** Full CSS box-shadow value for raised surfaces. */
  shadow: string;
  /** 0..1 strength of the accent glow in the page background. */
  glow: number;
  ok: string;
  warn: string;
  danger: string;
  /** The accent this palette suggests (must reach 3:1 on bg). The user's own accent always wins. */
  accentDefault: string;
  onAccentMode: OnAccentMode;
  /** Glass surface: translucent fill, 1px border, inset top specular line. All rgba. */
  glassFill: string;
  glassBorder: string;
  glassHighlight: string;
  /** Opaque colour laid over art/wallpaper backdrops (normally equal to bg), at the "dim" percentage. */
  scrim: string;
  /** 0..100: the smallest backdrop dim (%) that keeps text legible over the worst-case picture. Computed — see define.ts. */
  minDim: number;
  /** Three swatches for the tile: [page, raised surface, accent]. Opaque #rrggbb. */
  preview: readonly [string, string, string];
}

/** What a palette author writes: everything except minDim, which definePalette computes. */
export type PaletteSpec = Omit<Palette, 'minDim'>;

/** The palettes of one source file: a typed record for exactly the ids that file owns. */
export type PaletteGroup<K extends ThemeId> = Record<K, Palette>;

/**
 * Every Palette key. `Record<keyof Palette, true>` makes the compiler fail here when a field is added or removed,
 * so the completeness test can never silently go stale.
 */
const KEYS: Record<keyof Palette, true> = {
  id: true,
  label: true,
  blurb: true,
  scheme: true,
  bg: true,
  bg2: true,
  nav: true,
  card: true,
  cardHi: true,
  border: true,
  borderStrong: true,
  text: true,
  dim: true,
  track: true,
  shadow: true,
  glow: true,
  ok: true,
  warn: true,
  danger: true,
  accentDefault: true,
  onAccentMode: true,
  glassFill: true,
  glassBorder: true,
  glassHighlight: true,
  scrim: true,
  minDim: true,
  preview: true,
};
export const PALETTE_KEYS = Object.keys(KEYS) as Array<keyof Palette>;
