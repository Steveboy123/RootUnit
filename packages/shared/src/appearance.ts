// ---------------------------------------------------------------------------
// Appearance vocabulary — the ONE place the theme engine's option lists live.
// The Settings type, the validator, the server and the UI registry all derive from these arrays,
// so they cannot drift apart. Add a value here and the compiler points at everything that must handle it.
//
// RootUnit keeps every v2 value (a settings.json from a v2 head unit loads unchanged) and adds new ones after them.
// ---------------------------------------------------------------------------

/** Palettes. Order is the order tiles are shown in: dark, then light, then the high-visibility ones. */
export const THEME_IDS = [
  // dark
  'obsidian',
  'midnight',
  'carbon',
  'amoled',
  'ember',
  'ocean',
  'forest',
  'aurora',
  'synthwave',
  'nord',
  'mocha',
  'crimson',
  'royal',
  'plague',
  'tokyo',
  'vampire',
  'matrix',
  'nightcity',
  'amber',
  'nightred',
  'sunset',
  'cobalt',
  'gunmetal',
  'lunar',
  'velvet',
  'blueprint',
  'neonoir',
  'miami',
  'toxic',
  'rosegold',
  'abyss',
  'holo',
  // light
  'daylight',
  'sand',
  'mint',
  'sakura',
  'lavender',
  'arctic',
  'latte',
  'concrete',
  'paper',
  'peach',
  // high visibility
  'contrast',
  'sunlit',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** How cards and panels are drawn. */
export const SURFACES = ['solid', 'glass', 'outline', 'neon', 'clay', 'hud', 'chrome', 'aero', 'brutal', 'holo', 'terminal', 'lumen'] as const;
export type Surface = (typeof SURFACES)[number];

/** What is drawn behind the app. `none` is the palette gradient only. */
export const BACKGROUNDS = [
  'none',
  'art-blur',
  'art-cover',
  'art-ambient',
  'aurora',
  'gradient',
  'grid',
  'weave',
  'wallpaper',
  'mesh',
  'stars',
  'hex',
  'topo',
  'circuit',
  'dots',
  'waves',
  'synthsun',
  'bokeh',
  'scanlines',
  'halftone',
  'lowpoly',
  'rays',
  'plasma',
] as const;
export type Background = (typeof BACKGROUNDS)[number];

/** How much GPU the look may use: minimal = no blur or animation, balanced = one blurred layer, full = adds drift + backdrop blur. */
export const EFFECTS = ['minimal', 'balanced', 'full'] as const;
export type Effects = (typeof EFFECTS)[number];

/** GPU-friendly music artwork motion; independent of the Effects budget. */
export const ALBUM_MOTIONS = [
  'still',
  'vinyl',
  'float',
  'hologram',
  'glass',
  'orbit',
  'prism',
  'cd',
  'cassette',
  'tilt',
  'stack',
  'breathe',
  'polaroid',
  'glitch',
  'flip',
  'cube',
  'mirror',
  'sleeve',
] as const;
export type AlbumMotion = (typeof ALBUM_MOTIONS)[number];

/** Depth treatment of panels and cards. */
export const DEPTH_STYLES = ['flat', 'soft', 'deep', 'crystal', 'float', 'bevel', 'layered'] as const;
export type DepthStyle = (typeof DEPTH_STYLES)[number];

/** Decorative animation tempo. Off disables motion but keeps the static 3D styling. */
export const MOTION_SPEEDS = ['off', 'calm', 'lively', 'cinematic'] as const;
export type MotionSpeed = (typeof MOTION_SPEEDS)[number];

/** The animated scene behind Home (and the music pages), independent of the background picture. */
export const DASH_SCENES = [
  'off',
  'glow',
  'orbits',
  'grid',
  'particles',
  'warp',
  'waves',
  'rain',
  'fireflies',
  'matrix',
  'nebula',
  'snow',
  'lava',
  'rings',
  'comets',
  'bubbles',
  'tunnel',
  'synthsun',
  'circuit',
  'highway',
  'sakura',
  'embers',
  'radar',
  'skyline',
  'lightning',
] as const;
export type DashScene = (typeof DASH_SCENES)[number];

/** Glass surface finish; only affects rendering, never widget placement. */
export const GLASS_FINISHES = ['clear', 'frosted', 'prismatic', 'iridescent', 'smoked', 'liquid'] as const;
export type GlassFinish = (typeof GLASS_FINISHES)[number];

/** Music-responsive overlay. It sits above any background and below every control. */
export const BEAT_MODES = ['off', 'glow', 'wash', 'rings', 'spectrum', 'edges', 'halo', 'burst', 'wave', 'radial'] as const;
export type BeatMode = (typeof BEAT_MODES)[number];
export const BEAT_SOURCES = ['system', 'microphone'] as const;
export type BeatSource = (typeof BEAT_SOURCES)[number];
export const BEAT_COLORS = ['accent', 'album', 'rainbow', 'custom', 'heat'] as const;
export type BeatColorMode = (typeof BEAT_COLORS)[number];

/** Corner radius family. */
export const SHAPES = ['sharp', 'soft', 'round'] as const;
export type Shape = (typeof SHAPES)[number];

/** Mascot artwork, motion and the light around it. */
export const MASCOT_VARIANTS = ['original', 'transparent', 'armored'] as const;
export type MascotVariant = (typeof MASCOT_VARIANTS)[number];
export const MASCOT_MOTIONS = ['still', 'float', 'hologram', 'tilt', 'breathe', 'glitch', 'orbit', 'scan', 'peek', 'sway', 'pulse', 'bounce', 'drift'] as const;
export type MascotMotion = (typeof MASCOT_MOTIONS)[number];
export const MASCOT_AURAS = ['none', 'glow', 'halo', 'sparks', 'smoke', 'rings', 'aurora'] as const;
export type MascotAura = (typeof MASCOT_AURAS)[number];

/** Typeface of the whole interface. Every one is bundled with the app (no web fonts are fetched). */
export const FONTS = ['inter', 'system', 'grotesk', 'outfit', 'rounded', 'tech', 'future', 'mono'] as const;
export type FontId = (typeof FONTS)[number];

/** How one screen hands over to the next. */
export const PAGE_TRANSITIONS = ['none', 'fade', 'slide', 'rise', 'zoom', 'flip', 'depth', 'swing', 'cube', 'drop', 'tilt', 'portal'] as const;
export type PageTransition = (typeof PAGE_TRANSITIONS)[number];

/** What a press looks like on buttons and tiles. */
export const TOUCH_FX = ['none', 'ripple', 'glow', 'pop', 'sparkle', 'ring', 'press'] as const;
export type TouchFx = (typeof TOUCH_FX)[number];

/** How the speedometer and tachometer are drawn (Drive screen and gauge widgets). */
export const GAUGE_STYLES = ['arc', 'needle', 'digital', 'ring', 'bar', 'sport', 'led', 'hud'] as const;
export type GaugeStyle = (typeof GAUGE_STYLES)[number];

/** What the standby screen shows. */
export const STANDBY_STYLES = ['clock', 'analog', 'flip', 'mascot', 'orbit', 'minimal', 'nixie', 'words', 'binary'] as const;
export type StandbyStyle = (typeof STANDBY_STYLES)[number];

/**
 * How the navigation bar is drawn. Each works at the bottom and on either side:
 * island (classic dock), pill (floating pill), rail (edge rail), ghost (minimal icons), curve (glowing curve under the current button),
 * glass3d (raised 3D glass keys), split (two halves around a centre medallion with the album art), tabs (text tabs, no icons),
 * wave (a wave-shaped backing), mascot (the centre medallion is your mascot), neon (a glowing neon tube round the bar),
 * bubbles (every button its own floating bubble).
 */
export const DOCK_STYLES = ['island', 'rail', 'pill', 'ghost', 'curve', 'glass3d', 'split', 'tabs', 'wave', 'mascot', 'neon', 'bubbles'] as const;
export type DockStyle = (typeof DOCK_STYLES)[number];

/** Wallpapers drawn by the app itself (inline SVG scenes). Files the user drops in data/wallpapers/ are `user:<filename>`. */
export const BUILTIN_WALLPAPERS = [
  'night-road',
  'city-lights',
  'mountains',
  'dunes',
  'waves',
  'neon-city',
  'galaxy',
  'pine-forest',
  'coast-road',
  'canyon',
  'tunnel',
  'race-track',
  'aurora-lake',
  'synth-sunset',
  'ice-peaks',
  'liquid-chrome',
  'phantom-smoke',
  'eclipse',
  'vinyl-lounge',
  'sunset-gt',
  'cherry-road',
  'cyber-alley',
  'miami-beach',
  'deep-sea',
  'holo-waves',
  'paper-hills',
] as const;
export type BuiltinWallpaper = (typeof BUILTIN_WALLPAPERS)[number];

/**
 * A wallpaper id: a built-in scene, or `user:` followed by a plain file name. The name part matches exactly what the wallpapers
 * route serves (apps/server/src/wallpapers.ts WALLPAPER_NAME_RE): a letter or digit first, then letters, digits, `.`, `_`, `-` or a plain space
 * (so `My Photo.jpg` works). It can never carry a path separator, quote, markup or control character, never starts with a dot (no hidden
 * files) and never contains `..` (path-navigation tokens are refused here rather than left to the file route).
 */
export const WALLPAPER_ID_RE = new RegExp(`^(?:${BUILTIN_WALLPAPERS.join('|')}|user:(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._ -]{0,99})$`);

/** Inclusive integer ranges of the numeric appearance settings. Out-of-range values are clamped by the validator. */
export const APPEARANCE_RANGES = {
  /** Blur radius of the backdrop, px. */
  bgBlur: { min: 0, max: 60 },
  /** How much the backdrop is darkened (lightened on light palettes), %. Each palette enforces its own minimum on top. */
  bgDim: { min: 0, max: 90 },
  /** How see-through glass surfaces are, %. */
  glassOpacity: { min: 0, max: 100 },
  /** Size of all text, % of the designed size. */
  textScale: { min: 85, max: 130 },
  /** How busy the animated scene is (number and brightness of its particles), %. */
  sceneIntensity: { min: 10, max: 100 },
} as const;
