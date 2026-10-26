import type {
  AlbumMotion,
  Background,
  BeatColorMode,
  BeatMode,
  DashScene,
  DepthStyle,
  DockStyle,
  Effects,
  FontId,
  GaugeStyle,
  GlassFinish,
  MascotAura,
  MascotMotion,
  MascotVariant,
  MotionSpeed,
  PageTransition,
  Shape,
  StandbyStyle,
  Surface,
  TouchFx,
} from '@headunit/shared';

/**
 * A name and one line for every appearance option, in the words the Studio shows. Each table is keyed by the shared vocabulary, so a
 * value added in @headunit/shared fails the compiler here until it has a name.
 */
export interface Info {
  label: string;
  blurb: string;
}

export const SURFACE_INFO: Record<Surface, Info> = {
  solid: { label: 'Solid', blurb: 'Plain cards, the classic look' },
  glass: { label: 'Glass', blurb: 'Frosted, see-through cards' },
  outline: { label: 'Outline', blurb: 'Thin lines, no fill' },
  neon: { label: 'Neon', blurb: 'Edges that glow in your accent' },
  clay: { label: 'Clay', blurb: 'Soft, puffy, rounded' },
  hud: { label: 'HUD', blurb: 'Corner brackets, like a head-up display' },
  chrome: { label: 'Chrome', blurb: 'Polished metal rims' },
  aero: { label: 'Aero', blurb: 'Glossy glass with a sheen' },
};

export const BACKGROUND_INFO: Record<Background, Info & { art: boolean }> = {
  none: { label: 'None', blurb: 'Just the palette', art: false },
  'art-blur': { label: 'Album blur', blurb: 'The cover, softly blurred', art: true },
  'art-cover': { label: 'Album cover', blurb: 'The cover, big and sharp', art: true },
  'art-ambient': { label: 'Ambient', blurb: 'Colour clouds from the cover', art: true },
  aurora: { label: 'Aurora', blurb: 'Slow northern-light colours', art: false },
  gradient: { label: 'Gradient', blurb: 'Accent fading into the page', art: false },
  grid: { label: 'Grid', blurb: 'Retro blueprint lines', art: false },
  weave: { label: 'Carbon', blurb: 'Carbon-fibre weave', art: false },
  wallpaper: { label: 'Wallpaper', blurb: 'A picture you choose', art: false },
  mesh: { label: 'Mesh', blurb: 'Soft blended colour', art: false },
  stars: { label: 'Stars', blurb: 'A night sky', art: false },
  hex: { label: 'Hexagons', blurb: 'Honeycomb plates', art: false },
  topo: { label: 'Topographic', blurb: 'Map contour lines', art: false },
  circuit: { label: 'Circuit', blurb: 'Printed-circuit traces', art: false },
  dots: { label: 'Dots', blurb: 'A fine dot grid', art: false },
  waves: { label: 'Waves', blurb: 'Layered colour waves', art: false },
  synthsun: { label: 'Synth sun', blurb: 'Striped sun over a grid', art: false },
  bokeh: { label: 'Bokeh', blurb: 'Out-of-focus city lights', art: false },
  scanlines: { label: 'Scanlines', blurb: 'An old CRT screen', art: false },
};

export const EFFECTS_INFO: Record<Effects, Info> = {
  minimal: { label: 'Minimal', blurb: 'Lightest on the Pi: no blur and no animation' },
  balanced: { label: 'Balanced', blurb: 'Recommended: one soft blur, gentle motion' },
  full: { label: 'Full', blurb: 'Frosted glass and moving scenes; uses more GPU' },
};

export const DEPTH_INFO: Record<DepthStyle, Info> = {
  flat: { label: 'Flat', blurb: 'No shadows' },
  soft: { label: 'Soft', blurb: 'Gentle shadows' },
  deep: { label: 'Deep', blurb: 'Long, dark shadows' },
  crystal: { label: 'Crystal', blurb: 'Bright cut-glass edges' },
  float: { label: 'Floating', blurb: 'Cards hover above the page' },
  bevel: { label: 'Bevel', blurb: 'Raised edges, like keys' },
  layered: { label: 'Layered', blurb: 'Stacked sheets of glass' },
};

export const MOTION_INFO: Record<MotionSpeed, Info> = {
  off: { label: 'Off', blurb: 'Nothing moves by itself' },
  calm: { label: 'Calm', blurb: 'Slow and subtle' },
  lively: { label: 'Lively', blurb: 'More movement, still smooth' },
  cinematic: { label: 'Cinematic', blurb: 'Big, sweeping motion' },
};

export const SCENE_INFO: Record<DashScene, Info> = {
  off: { label: 'Off', blurb: 'Nothing behind the widgets' },
  glow: { label: 'Glow', blurb: 'Breathing light' },
  orbits: { label: 'Orbits', blurb: 'Rings that turn' },
  grid: { label: 'Grid', blurb: 'A rolling neon floor' },
  particles: { label: 'Particles', blurb: 'Drifting motes of light' },
  warp: { label: 'Warp', blurb: 'Stars rushing past' },
  waves: { label: 'Waves', blurb: 'Rolling bands of colour' },
  rain: { label: 'Rain', blurb: 'Falling streaks' },
  fireflies: { label: 'Fireflies', blurb: 'Blinking lights' },
  matrix: { label: 'Matrix', blurb: 'Falling code' },
  nebula: { label: 'Nebula', blurb: 'Clouds of colour' },
  snow: { label: 'Snow', blurb: 'Soft falling flakes' },
  lava: { label: 'Lava', blurb: 'Slow blobs of light' },
  rings: { label: 'Rings', blurb: 'Pulses spreading out' },
  comets: { label: 'Comets', blurb: 'Streaks across the sky' },
  bubbles: { label: 'Bubbles', blurb: 'Rising bubbles' },
  tunnel: { label: 'Tunnel', blurb: 'Driving into light' },
  synthsun: { label: 'Synth sun', blurb: 'A sun setting over a grid' },
  circuit: { label: 'Circuit', blurb: 'Pulses along traces' },
};

export const GLASS_INFO: Record<GlassFinish, Info> = {
  clear: { label: 'Clear', blurb: 'Plain see-through glass' },
  frosted: { label: 'Frosted', blurb: 'Milky, softly lit' },
  prismatic: { label: 'Prismatic', blurb: 'A rainbow edge' },
  iridescent: { label: 'Iridescent', blurb: 'Shifting oil-slick colours' },
  smoked: { label: 'Smoked', blurb: 'Dark tinted glass' },
  liquid: { label: 'Liquid', blurb: 'A moving sheen' },
};

export const BEAT_INFO: Record<BeatMode, Info> = {
  off: { label: 'Off', blurb: 'Nothing reacts to the music' },
  glow: { label: 'Glow', blurb: 'The screen edges breathe' },
  wash: { label: 'Wash', blurb: 'A colour wash on the beat' },
  rings: { label: 'Rings', blurb: 'Rings pulse out' },
  spectrum: { label: 'Spectrum', blurb: 'Bars along the bottom' },
  edges: { label: 'Edges', blurb: 'Light runs round the edges' },
  halo: { label: 'Halo', blurb: 'A halo round the artwork' },
  burst: { label: 'Burst', blurb: 'A flash on every hit' },
  wave: { label: 'Wave', blurb: 'A waveform line' },
  radial: { label: 'Radial', blurb: 'A circular spectrum' },
};

export const BEAT_COLOR_INFO: Record<BeatColorMode, Info> = {
  accent: { label: 'Accent', blurb: 'Your accent colour' },
  album: { label: 'Album', blurb: 'From the cover' },
  rainbow: { label: 'Rainbow', blurb: 'Every colour' },
  custom: { label: 'Custom', blurb: 'One you choose' },
  heat: { label: 'Heat', blurb: 'Blue to red with the volume' },
};

export const SHAPE_INFO: Record<Shape, Info> = {
  sharp: { label: 'Sharp', blurb: 'Square corners' },
  soft: { label: 'Soft', blurb: 'Rounded corners' },
  round: { label: 'Round', blurb: 'Big round corners' },
};

export const MASCOT_INFO: Record<MascotVariant, Info> = {
  original: { label: 'Original', blurb: 'The full artwork' },
  transparent: { label: 'Neon cut-out', blurb: 'Just the figure, glowing' },
  armored: { label: '3D armour', blurb: 'Armoured, sculpted' },
};

export const MASCOT_MOTION_INFO: Record<MascotMotion, Info> = {
  still: { label: 'Still', blurb: 'No movement' },
  float: { label: 'Float', blurb: 'Hovers gently' },
  hologram: { label: 'Hologram', blurb: 'Scanlines and flicker' },
  tilt: { label: '3D tilt', blurb: 'Turns slowly in 3D' },
  breathe: { label: 'Breathe', blurb: 'Swells and settles' },
  glitch: { label: 'Glitch', blurb: 'Digital tears now and then' },
  orbit: { label: 'Orbit', blurb: 'Circles slowly' },
  scan: { label: 'Scan', blurb: 'A light sweeps over it' },
  peek: { label: 'Peek', blurb: 'Leans in from the edge' },
  sway: { label: 'Sway', blurb: 'Rocks side to side' },
  pulse: { label: 'Pulse', blurb: 'Glows in time' },
};

export const MASCOT_AURA_INFO: Record<MascotAura, Info> = {
  none: { label: 'None', blurb: 'No light round it' },
  glow: { label: 'Glow', blurb: 'A soft glow' },
  halo: { label: 'Halo', blurb: 'A ring of light' },
  sparks: { label: 'Sparks', blurb: 'Rising sparks' },
  smoke: { label: 'Smoke', blurb: 'Drifting smoke' },
};

export const FONT_INFO: Record<FontId, Info & { family: string }> = {
  inter: { label: 'Inter', blurb: 'Clean and clear', family: "'Inter Variable', system-ui, sans-serif" },
  system: { label: 'System', blurb: 'The device’s own', family: 'system-ui, sans-serif' },
  grotesk: { label: 'Grotesk', blurb: 'Modern, a little quirky', family: "'Space Grotesk Variable', sans-serif" },
  outfit: { label: 'Outfit', blurb: 'Geometric and friendly', family: "'Outfit Variable', sans-serif" },
  rounded: { label: 'Rounded', blurb: 'Soft round letters', family: "'Nunito Variable', sans-serif" },
  tech: { label: 'Tech', blurb: 'Narrow, like a dashboard', family: "'Rajdhani', sans-serif" },
  future: { label: 'Future', blurb: 'Wide sci-fi capitals', family: "'Orbitron Variable', sans-serif" },
  mono: { label: 'Mono', blurb: 'Terminal style', family: "'JetBrains Mono Variable', monospace" },
};

export const TRANSITION_INFO: Record<PageTransition, Info> = {
  none: { label: 'Instant', blurb: 'No animation' },
  fade: { label: 'Fade', blurb: 'Cross-fade' },
  slide: { label: 'Slide', blurb: 'Slides in from the side' },
  rise: { label: 'Rise', blurb: 'Rises from below' },
  zoom: { label: 'Zoom', blurb: 'Zooms in' },
  flip: { label: 'Flip', blurb: 'Flips like a card' },
  depth: { label: 'Depth', blurb: 'Comes forward from behind' },
  swing: { label: 'Swing', blurb: 'Swings open like a door' },
};

export const TOUCH_INFO: Record<TouchFx, Info> = {
  none: { label: 'None', blurb: 'No touch feedback' },
  ripple: { label: 'Ripple', blurb: 'A ripple where you tap' },
  glow: { label: 'Glow', blurb: 'A soft flash of light' },
  pop: { label: 'Pop', blurb: 'Buttons spring when pressed' },
};

export const GAUGE_INFO: Record<GaugeStyle, Info> = {
  arc: { label: 'Arc', blurb: 'A sweeping arc' },
  needle: { label: 'Needle', blurb: 'A classic dial' },
  digital: { label: 'Digital', blurb: 'Big numbers' },
  ring: { label: 'Ring', blurb: 'A full circle' },
  bar: { label: 'Bar', blurb: 'A segmented bar' },
  sport: { label: 'Sport', blurb: 'A race-car dial' },
};

export const STANDBY_INFO: Record<StandbyStyle, Info> = {
  clock: { label: 'Clock', blurb: 'Big digital time' },
  analog: { label: 'Analog', blurb: 'A watch face' },
  flip: { label: 'Flip', blurb: 'Flip-card digits' },
  mascot: { label: 'Mascot', blurb: 'Your mascot and the time' },
  orbit: { label: 'Orbit', blurb: 'Time in turning rings' },
  minimal: { label: 'Minimal', blurb: 'Small, dim and quiet' },
};

export const DOCK_INFO: Record<DockStyle, Info> = {
  island: { label: 'Classic dock', blurb: 'A floating bar with rounded corners' },
  pill: { label: 'Floating pill', blurb: 'Slim and fully rounded' },
  rail: { label: 'Edge rail', blurb: 'Fastened to the edge of the screen' },
  ghost: { label: 'Minimal icons', blurb: 'Just the icons, no backing' },
  curve: { label: 'Glowing curve', blurb: 'An edge of light, the page you are on lit up' },
  glass3d: { label: '3D glass', blurb: 'Every button a raised glass key' },
  split: { label: 'Split', blurb: 'Two halves round the album art' },
  tabs: { label: 'Text tabs', blurb: 'Names only, in tabs' },
  wave: { label: 'Wave', blurb: 'A bar shaped like a wave' },
  mascot: { label: 'Mascot', blurb: 'Your mascot in the middle' },
};

export const ALBUM_MOTION_INFO: Record<AlbumMotion, Info> = {
  still: { label: 'Classic', blurb: 'The plain cover' },
  vinyl: { label: 'Spinning vinyl', blurb: 'A record that turns while it plays' },
  float: { label: 'Floating 3D', blurb: 'The cover hovers and tilts' },
  hologram: { label: 'Hologram', blurb: 'Projected above a glowing ring' },
  glass: { label: 'Glass 3D', blurb: 'Cover behind glass' },
  orbit: { label: 'Orbit', blurb: 'Rings circle the cover' },
  prism: { label: 'Prism', blurb: 'Rainbow edges' },
  cd: { label: 'Compact disc', blurb: 'A shiny disc' },
  cassette: { label: 'Cassette', blurb: 'A tape with turning reels' },
  tilt: { label: 'Parallax tilt', blurb: 'Leans as it plays' },
  stack: { label: 'Stack', blurb: 'A pile of sleeves' },
  breathe: { label: 'Breathe', blurb: 'Swells with the music' },
  polaroid: { label: 'Polaroid', blurb: 'An instant photo' },
  glitch: { label: 'Glitch', blurb: 'Digital tears' },
  flip: { label: 'Flip', blurb: 'Turns over now and then' },
};

/** `{ value, label }` options for a ChoiceChips / Segment from a table. */
export const optionsOf = <T extends string>(table: Record<T, Info>, order: readonly T[]) => order.map((value) => ({ value, label: table[value].label }));
