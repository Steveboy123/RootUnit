import type { BuiltinWallpaper, Settings } from '@headunit/shared';

/**
 * One-tap combinations. A preset is plain data: applying one sends its `patch` through the normal settings path, so it is validated like
 * any other change, and the person can adjust every part afterwards. Presets never touch units, music, the navigation or anything that is
 * not appearance.
 *
 *  · looks      — v2's Looks: palette + style + background + shape + accent.
 *  · scenes     — v2's 3D scene presets: a look plus album motion, depth, tempo, background animation and glass.
 *  · signature  — new in RootUnit: complete themes that also choose the typeface, the page transition, the gauges and the mascot's mood.
 *  · featured   — the showcase looks: everything matched, down to the wallpaper, the navigation bar and how the mascot moves.
 * The 3D scenes keep v2's values and add the matching typeface, transition, gauges, bar and mascot mood, so nothing in a scene clashes.
 */
export type PresetGroup = 'featured' | 'signature' | 'scenes' | 'looks';

export const PRESET_GROUPS: ReadonlyArray<{ id: PresetGroup; label: string; blurb: string }> = [
  { id: 'featured', label: 'Featured', blurb: 'Showcase looks, matched from the wallpaper to the navigation bar.' },
  { id: 'signature', label: 'Signature', blurb: 'Complete themes: colours, motion, type and transitions together.' },
  { id: 'scenes', label: '3D scenes', blurb: 'A look plus album motion, depth and a moving background.' },
  { id: 'looks', label: 'Looks', blurb: 'Palette, style, background and accent.' },
];

/** The settings a preset may set. */
export type PresetPatch = Partial<
  Pick<
    Settings,
    | 'theme'
    | 'accent'
    | 'surface'
    | 'background'
    | 'shape'
    | 'wallpaper'
    | 'effects'
    | 'albumMotion'
    | 'depthStyle'
    | 'motionSpeed'
    | 'dashScene'
    | 'glassFinish'
    | 'font'
    | 'transition'
    | 'gaugeStyle'
    | 'mascotMotion'
    | 'mascotAura'
    | 'dockStyle'
    | 'touchFx'
    | 'mascotGlow'
  >
>;

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  group: PresetGroup;
  patch: PresetPatch & Pick<Settings, 'theme' | 'accent'>;
  /** A wallpaper that pictures the look on its gallery tile (its own wallpaper when it has one). */
  thumb?: BuiltinWallpaper;
}

const look = (id: string, label: string, blurb: string, patch: Preset['patch']): Preset => ({ id, label, blurb, group: 'looks', patch });
/** A v2 scene: v2's values, then the RootUnit finish that matches them. */
const scene = (id: string, label: string, blurb: string, patch: Preset['patch'], finish: PresetPatch, thumb: BuiltinWallpaper): Preset => ({ id, label, blurb, group: 'scenes', patch: { ...patch, ...finish }, thumb });
const featured = (id: string, label: string, blurb: string, patch: Preset['patch']): Preset => ({ id, label, blurb, group: 'featured', patch, thumb: patch.wallpaper as BuiltinWallpaper | undefined });
const signature = (id: string, label: string, blurb: string, patch: Preset['patch']): Preset => ({ id, label, blurb, group: 'signature', patch });

export const PRESETS: readonly Preset[] = [
  // --- Featured (the showcase looks) -------------------------------------------------------------------------------------------
  featured('retro-synthwave', 'Retro Synthwave', 'Neon sunsets, palm trees and a grid to the horizon.', {
    theme: 'synthwave', accent: '#ff2bd6', surface: 'neon', background: 'wallpaper', wallpaper: 'synth-sunset', shape: 'soft', effects: 'full',
    albumMotion: 'vinyl', depthStyle: 'deep', motionSpeed: 'lively', dashScene: 'synthsun', glassFinish: 'prismatic',
    font: 'future', transition: 'slide', gaugeStyle: 'sport', dockStyle: 'curve', touchFx: 'glow', mascotMotion: 'float', mascotAura: 'glow', mascotGlow: 70,
  }),
  featured('arctic-crystal', 'Arctic Crystal', 'Cool blue ice and clear glass, clean and modern.', {
    theme: 'blueprint', accent: '#7fe3ff', surface: 'glass', background: 'wallpaper', wallpaper: 'ice-peaks', shape: 'round', effects: 'full',
    albumMotion: 'float', depthStyle: 'crystal', motionSpeed: 'calm', dashScene: 'snow', glassFinish: 'frosted',
    font: 'outfit', transition: 'depth', gaugeStyle: 'ring', dockStyle: 'glass3d', touchFx: 'ripple', mascotMotion: 'breathe', mascotAura: 'halo', mascotGlow: 55,
  }),
  featured('phantom-pink', 'Phantom Pink', 'Dark and edgy cyberpunk, with your mascot in the middle.', {
    theme: 'plague', accent: '#ff2a93', surface: 'neon', background: 'wallpaper', wallpaper: 'phantom-smoke', shape: 'sharp', effects: 'full',
    albumMotion: 'hologram', depthStyle: 'deep', motionSpeed: 'cinematic', dashScene: 'particles', glassFinish: 'smoked',
    font: 'grotesk', transition: 'zoom', gaugeStyle: 'sport', dockStyle: 'mascot', touchFx: 'glow', mascotMotion: 'hologram', mascotAura: 'smoke', mascotGlow: 85,
  }),
  featured('liquid-metal', 'Liquid Chrome', 'Polished metal and glass, sleek and luxurious.', {
    theme: 'lunar', accent: '#d7dde8', surface: 'chrome', background: 'wallpaper', wallpaper: 'liquid-chrome', shape: 'round', effects: 'full',
    albumMotion: 'glass', depthStyle: 'bevel', motionSpeed: 'calm', dashScene: 'glow', glassFinish: 'liquid',
    font: 'inter', transition: 'zoom', gaugeStyle: 'needle', dockStyle: 'glass3d', touchFx: 'pop', mascotMotion: 'tilt', mascotAura: 'glow', mascotGlow: 40,
  }),
  featured('stealth-amoled', 'Stealth AMOLED', 'True black, an eclipse, almost nothing lit.', {
    theme: 'amoled', accent: '#2f7bff', surface: 'outline', background: 'wallpaper', wallpaper: 'eclipse', shape: 'soft', effects: 'balanced',
    albumMotion: 'float', depthStyle: 'flat', motionSpeed: 'calm', dashScene: 'off', glassFinish: 'smoked',
    font: 'inter', transition: 'fade', gaugeStyle: 'digital', dockStyle: 'ghost', touchFx: 'glow', mascotMotion: 'breathe', mascotAura: 'none', mascotGlow: 25,
  }),
  featured('nature-drive', 'Nature Drive', 'Pine forest, fireflies and soft green glass.', {
    theme: 'forest', accent: '#79e06a', surface: 'glass', background: 'wallpaper', wallpaper: 'pine-forest', shape: 'round', effects: 'balanced',
    albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'fireflies', glassFinish: 'frosted',
    font: 'rounded', transition: 'rise', gaugeStyle: 'arc', dockStyle: 'pill', touchFx: 'ripple', mascotMotion: 'sway', mascotAura: 'glow', mascotGlow: 35,
  }),

  // --- Signature (RootUnit) ---------------------------------------------------------------------------------------------------
  signature('rootunit', 'RootUnit', 'Obsidian glass over a slow colour mesh.', {
    theme: 'obsidian', accent: '#a66bff', surface: 'glass', background: 'mesh', shape: 'soft', effects: 'balanced',
    albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'particles', glassFinish: 'frosted',
    font: 'inter', transition: 'depth', gaugeStyle: 'arc', dockStyle: 'island', touchFx: 'ripple',
  }),
  signature('plague-doctor', 'Plague Doctor', 'The mascot’s neon, smoke and holograms.', {
    theme: 'plague', accent: '#ff2a93', surface: 'neon', background: 'mesh', shape: 'sharp', effects: 'full',
    albumMotion: 'hologram', depthStyle: 'deep', motionSpeed: 'cinematic', dashScene: 'fireflies', glassFinish: 'iridescent',
    font: 'future', transition: 'zoom', gaugeStyle: 'sport', mascotMotion: 'hologram', mascotAura: 'smoke', touchFx: 'glow',
  }),
  signature('tokyo-drift', 'Tokyo Drift', 'Rain on glass over a neon skyline.', {
    theme: 'tokyo', accent: '#7aa2f7', surface: 'glass', background: 'wallpaper', wallpaper: 'neon-city', shape: 'round', effects: 'full',
    albumMotion: 'cd', depthStyle: 'float', motionSpeed: 'calm', dashScene: 'rain', glassFinish: 'liquid',
    font: 'grotesk', transition: 'slide', gaugeStyle: 'ring', touchFx: 'ripple',
  }),
  signature('replicant', 'Replicant', 'Acid-yellow HUD, scanlines and glitches.', {
    theme: 'nightcity', accent: '#f3e600', surface: 'hud', background: 'scanlines', shape: 'sharp', effects: 'full',
    albumMotion: 'glitch', depthStyle: 'flat', motionSpeed: 'lively', dashScene: 'rain', glassFinish: 'smoked',
    font: 'tech', transition: 'flip', gaugeStyle: 'digital', mascotMotion: 'glitch', touchFx: 'glow',
  }),
  signature('digital-rain', 'Digital Rain', 'Falling green code and circuit traces.', {
    theme: 'matrix', accent: '#00ff6a', surface: 'outline', background: 'circuit', shape: 'sharp', effects: 'full',
    albumMotion: 'glitch', depthStyle: 'flat', motionSpeed: 'lively', dashScene: 'matrix', glassFinish: 'clear',
    font: 'mono', transition: 'fade', gaugeStyle: 'digital', mascotMotion: 'scan', touchFx: 'glow',
  }),
  signature('retro-terminal', 'Retro Terminal', 'An amber CRT with a cassette deck.', {
    theme: 'amber', accent: '#ffb000', surface: 'hud', background: 'scanlines', shape: 'sharp', effects: 'balanced',
    albumMotion: 'cassette', depthStyle: 'flat', motionSpeed: 'calm', dashScene: 'particles', glassFinish: 'smoked',
    font: 'mono', transition: 'fade', gaugeStyle: 'bar', touchFx: 'pop',
  }),
  signature('vaporwave', 'Vaporwave', 'Glossy aero glass under a striped sun.', {
    theme: 'synthwave', accent: '#ff4dac', surface: 'aero', background: 'synthsun', shape: 'round', effects: 'full',
    albumMotion: 'polaroid', depthStyle: 'layered', motionSpeed: 'calm', dashScene: 'synthsun', glassFinish: 'iridescent',
    font: 'future', transition: 'swing', gaugeStyle: 'sport', mascotAura: 'halo', touchFx: 'pop',
  }),
  signature('deep-space', 'Deep Space', 'Warp-speed stars and orbiting artwork.', {
    theme: 'obsidian', accent: '#7fd6ff', surface: 'glass', background: 'stars', shape: 'round', effects: 'full',
    albumMotion: 'orbit', depthStyle: 'crystal', motionSpeed: 'cinematic', dashScene: 'warp', glassFinish: 'prismatic',
    font: 'future', transition: 'depth', gaugeStyle: 'ring', mascotMotion: 'orbit', touchFx: 'ripple',
  }),
  signature('nebula', 'Nebula', 'Violet clouds drifting through starlight.', {
    theme: 'aurora', accent: '#a695ff', surface: 'glass', background: 'stars', shape: 'round', effects: 'full',
    albumMotion: 'prism', depthStyle: 'crystal', motionSpeed: 'calm', dashScene: 'nebula', glassFinish: 'iridescent',
    font: 'outfit', transition: 'zoom', gaugeStyle: 'ring', mascotAura: 'sparks', touchFx: 'glow',
  }),
  signature('ocean-breeze', 'Ocean Breeze', 'Rolling waves and rising bubbles.', {
    theme: 'ocean', accent: '#2dd4cf', surface: 'glass', background: 'waves', shape: 'round', effects: 'full',
    albumMotion: 'float', depthStyle: 'float', motionSpeed: 'calm', dashScene: 'bubbles', glassFinish: 'liquid',
    font: 'rounded', transition: 'rise', gaugeStyle: 'arc', mascotMotion: 'sway', touchFx: 'ripple',
  }),
  signature('lava-lounge', 'Lava Lounge', 'Slow lava blobs and a spinning record.', {
    theme: 'velvet', accent: '#ff8fb1', surface: 'clay', background: 'gradient', shape: 'round', effects: 'balanced',
    albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'lava', glassFinish: 'frosted',
    font: 'rounded', transition: 'rise', gaugeStyle: 'arc', mascotMotion: 'breathe', touchFx: 'pop',
  }),
  signature('blueprint-lab', 'Blueprint Lab', 'White ink on drafting blue, pulses on the traces.', {
    theme: 'blueprint', accent: '#7fe3ff', surface: 'outline', background: 'grid', shape: 'sharp', effects: 'balanced',
    albumMotion: 'still', depthStyle: 'flat', motionSpeed: 'calm', dashScene: 'circuit', glassFinish: 'clear',
    font: 'tech', transition: 'slide', gaugeStyle: 'needle', touchFx: 'ripple',
  }),
  signature('moonlight', 'Moonlight', 'Chrome and silver under shooting stars.', {
    theme: 'lunar', accent: '#d7dde8', surface: 'chrome', background: 'stars', shape: 'soft', effects: 'balanced',
    albumMotion: 'cd', depthStyle: 'bevel', motionSpeed: 'calm', dashScene: 'comets', glassFinish: 'smoked',
    font: 'grotesk', transition: 'fade', gaugeStyle: 'needle', mascotAura: 'halo', touchFx: 'ripple',
  }),
  signature('night-vision', 'Night Vision', 'Only reds and nothing moving: for dark roads.', {
    theme: 'nightred', accent: '#ff3b2f', surface: 'outline', background: 'none', shape: 'soft', effects: 'minimal',
    albumMotion: 'still', depthStyle: 'flat', motionSpeed: 'off', dashScene: 'off', glassFinish: 'clear',
    font: 'tech', transition: 'none', gaugeStyle: 'digital', touchFx: 'none',
  }),
  signature('track-day', 'Track Day', 'Racing red chrome and a sport tacho.', {
    theme: 'crimson', accent: '#ff3547', surface: 'chrome', background: 'wallpaper', wallpaper: 'race-track', shape: 'sharp', effects: 'full',
    albumMotion: 'tilt', depthStyle: 'deep', motionSpeed: 'lively', dashScene: 'tunnel', glassFinish: 'smoked',
    font: 'tech', transition: 'slide', gaugeStyle: 'sport', touchFx: 'pop',
  }),
  signature('gothic', 'Gothic', 'Orchid violet, hex stone and drifting embers.', {
    theme: 'vampire', accent: '#bd93f9', surface: 'glass', background: 'hex', shape: 'soft', effects: 'balanced',
    albumMotion: 'vinyl', depthStyle: 'layered', motionSpeed: 'calm', dashScene: 'fireflies', glassFinish: 'smoked',
    font: 'grotesk', transition: 'depth', gaugeStyle: 'needle', mascotAura: 'smoke', touchFx: 'glow',
  }),
  signature('workshop', 'Workshop', 'Steel, safety orange and contour lines.', {
    theme: 'gunmetal', accent: '#ff8a3d', surface: 'solid', background: 'topo', shape: 'soft', effects: 'balanced',
    albumMotion: 'stack', depthStyle: 'bevel', motionSpeed: 'calm', dashScene: 'off', glassFinish: 'clear',
    font: 'grotesk', transition: 'slide', gaugeStyle: 'needle', touchFx: 'pop',
  }),
  signature('cobalt-code', 'Cobalt Code', 'Glossy cobalt and pulses through the circuit.', {
    theme: 'cobalt', accent: '#ffc600', surface: 'aero', background: 'hex', shape: 'soft', effects: 'balanced',
    albumMotion: 'flip', depthStyle: 'float', motionSpeed: 'lively', dashScene: 'circuit', glassFinish: 'clear',
    font: 'mono', transition: 'flip', gaugeStyle: 'bar', touchFx: 'ripple',
  }),
  signature('aurora-lake', 'Aurora Lake', 'Northern lights over a still lake.', {
    theme: 'forest', accent: '#79e06a', surface: 'glass', background: 'wallpaper', wallpaper: 'aurora-lake', shape: 'round', effects: 'full',
    albumMotion: 'breathe', depthStyle: 'float', motionSpeed: 'calm', dashScene: 'fireflies', glassFinish: 'frosted',
    font: 'outfit', transition: 'rise', gaugeStyle: 'arc', touchFx: 'ripple',
  }),
  signature('golden-hour', 'Golden Hour', 'A coral sun setting over the coast road.', {
    theme: 'sunset', accent: '#ff7b54', surface: 'glass', background: 'wallpaper', wallpaper: 'coast-road', shape: 'round', effects: 'balanced',
    albumMotion: 'tilt', depthStyle: 'float', motionSpeed: 'calm', dashScene: 'waves', glassFinish: 'iridescent',
    font: 'outfit', transition: 'swing', gaugeStyle: 'arc', mascotAura: 'glow', touchFx: 'ripple',
  }),
  signature('first-snow', 'First Snow', 'Glacier white glass and falling snow.', {
    theme: 'arctic', accent: '#00796b', surface: 'glass', background: 'dots', shape: 'round', effects: 'balanced',
    albumMotion: 'polaroid', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'snow', glassFinish: 'frosted',
    font: 'rounded', transition: 'fade', gaugeStyle: 'ring', touchFx: 'ripple',
  }),
  signature('cherry-blossom', 'Cherry Blossom', 'Blossom pink, soft clay and drifting bokeh.', {
    theme: 'sakura', accent: '#c2185b', surface: 'clay', background: 'bokeh', shape: 'round', effects: 'balanced',
    albumMotion: 'polaroid', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'bubbles', glassFinish: 'frosted',
    font: 'rounded', transition: 'rise', gaugeStyle: 'arc', touchFx: 'pop',
  }),
  signature('cafe', 'Café', 'Cream, mauve and a record on the turntable.', {
    theme: 'latte', accent: '#7c3bd6', surface: 'clay', background: 'gradient', shape: 'round', effects: 'balanced',
    albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', dashScene: 'off', glassFinish: 'clear',
    font: 'outfit', transition: 'fade', gaugeStyle: 'arc', touchFx: 'pop',
  }),
  signature('lavender-fields', 'Lavender Fields', 'Lilac glass over contour lines.', {
    theme: 'lavender', accent: '#6a3fd1', surface: 'glass', background: 'topo', shape: 'round', effects: 'balanced',
    albumMotion: 'float', depthStyle: 'float', motionSpeed: 'calm', dashScene: 'fireflies', glassFinish: 'frosted',
    font: 'outfit', transition: 'rise', gaugeStyle: 'ring', touchFx: 'ripple',
  }),
  signature('concrete-jungle', 'Concrete Jungle', 'Raw grey, safety orange, big digital numbers.', {
    theme: 'concrete', accent: '#c24c00', surface: 'solid', background: 'dots', shape: 'sharp', effects: 'balanced',
    albumMotion: 'stack', depthStyle: 'layered', motionSpeed: 'calm', dashScene: 'off', glassFinish: 'clear',
    font: 'grotesk', transition: 'slide', gaugeStyle: 'digital', touchFx: 'pop',
  }),

  // --- 3D scenes (v2, unchanged) ----------------------------------------------------------------------------------------------
  scene('cyber-neon', 'Cyber Neon', 'Hot pink neon, holograms and orbit rings.', { theme: 'synthwave', accent: '#ff4fd8', background: 'grid', surface: 'neon', albumMotion: 'hologram', depthStyle: 'deep', motionSpeed: 'cinematic', effects: 'full', dashScene: 'orbits', glassFinish: 'prismatic' }, { font: 'future', transition: 'zoom', gaugeStyle: 'sport', dockStyle: 'curve', touchFx: 'glow', mascotMotion: 'hologram', mascotAura: 'glow' }, 'neon-city'),
  scene('ocean-glass', 'Ocean Glass', 'Aqua crystal over ambient album colour.', { theme: 'ocean', accent: '#2dd4cf', background: 'art-ambient', surface: 'glass', albumMotion: 'glass', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'glow', glassFinish: 'frosted' }, { font: 'outfit', transition: 'depth', gaugeStyle: 'ring', dockStyle: 'pill', touchFx: 'ripple', mascotMotion: 'float', mascotAura: 'halo' }, 'waves'),
  scene('vinyl-lounge', 'Vinyl Lounge', 'Gold on carbon weave with a spinning record.', { theme: 'royal', accent: '#e6b94a', background: 'weave', surface: 'glass', albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', effects: 'balanced', dashScene: 'glow', glassFinish: 'clear' }, { font: 'grotesk', transition: 'fade', gaugeStyle: 'needle', dockStyle: 'island', touchFx: 'ripple', mascotMotion: 'sway', mascotAura: 'glow' }, 'vinyl-lounge'),
  scene('aurora-3d', 'Aurora 3D', 'Northern lights with hologram artwork.', { theme: 'carbon', accent: '#a78bfa', background: 'aurora', surface: 'glass', albumMotion: 'hologram', depthStyle: 'deep', motionSpeed: 'calm', effects: 'full', dashScene: 'orbits', glassFinish: 'prismatic' }, { font: 'outfit', transition: 'depth', gaugeStyle: 'ring', dockStyle: 'glass3d', touchFx: 'ripple', mascotMotion: 'float', mascotAura: 'halo' }, 'aurora-lake'),
  scene('night-racer', 'Night Racer', 'Red neon on weave and a laser grid.', { theme: 'crimson', accent: '#ff3b47', background: 'weave', surface: 'neon', albumMotion: 'orbit', depthStyle: 'deep', motionSpeed: 'cinematic', effects: 'full', dashScene: 'grid', glassFinish: 'clear' }, { font: 'tech', transition: 'slide', gaugeStyle: 'sport', dockStyle: 'curve', touchFx: 'glow', mascotMotion: 'glitch', mascotAura: 'sparks' }, 'race-track'),
  scene('amoled-eclipse', 'AMOLED Eclipse', 'True black with the cover floating in crystal.', { theme: 'amoled', accent: '#2f7bff', background: 'art-cover', surface: 'glass', albumMotion: 'float', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'orbits', glassFinish: 'frosted' }, { font: 'inter', transition: 'fade', gaugeStyle: 'digital', dockStyle: 'ghost', touchFx: 'glow', mascotMotion: 'breathe', mascotAura: 'halo' }, 'eclipse'),
  scene('sunset-gt', 'Sunset GT', 'Warm paper glass with a vinyl record.', { theme: 'sand', accent: '#b5502d', background: 'gradient', surface: 'glass', albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', effects: 'balanced', dashScene: 'glow', glassFinish: 'clear' }, { font: 'grotesk', transition: 'slide', gaugeStyle: 'needle', dockStyle: 'pill', touchFx: 'ripple', mascotMotion: 'sway', mascotAura: 'glow' }, 'sunset-gt'),
  scene('focus-hud', 'Focus HUD', 'High contrast, nothing moving.', { theme: 'contrast', accent: '#ffd400', background: 'none', surface: 'outline', albumMotion: 'still', depthStyle: 'flat', motionSpeed: 'off', effects: 'minimal', dashScene: 'off', glassFinish: 'clear' }, { font: 'tech', transition: 'none', gaugeStyle: 'digital', dockStyle: 'tabs', touchFx: 'none', mascotMotion: 'still', mascotAura: 'none' }, 'tunnel'),
  scene('crystal-palace', 'Crystal Palace', 'Frost cyan prisms over the aurora.', { theme: 'nord', accent: '#8de8fc', background: 'aurora', surface: 'glass', albumMotion: 'prism', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'orbits', glassFinish: 'prismatic' }, { font: 'outfit', transition: 'depth', gaugeStyle: 'ring', dockStyle: 'glass3d', touchFx: 'ripple', mascotMotion: 'float', mascotAura: 'halo' }, 'ice-peaks'),
  scene('liquid-chrome', 'Silver Grid', 'Silver crystal on a laser grid.', { theme: 'carbon', accent: '#d1d5db', background: 'grid', surface: 'glass', albumMotion: 'glass', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'grid', glassFinish: 'prismatic' }, { font: 'inter', transition: 'zoom', gaugeStyle: 'needle', dockStyle: 'glass3d', touchFx: 'pop', mascotMotion: 'tilt', mascotAura: 'glow' }, 'liquid-chrome'),
  scene('emerald-matrix', 'Emerald Matrix', 'Emerald neon and orbiting artwork.', { theme: 'forest', accent: '#2fffa3', background: 'grid', surface: 'neon', albumMotion: 'orbit', depthStyle: 'deep', motionSpeed: 'cinematic', effects: 'full', dashScene: 'grid', glassFinish: 'clear' }, { font: 'mono', transition: 'flip', gaugeStyle: 'digital', dockStyle: 'rail', touchFx: 'glow', mascotMotion: 'glitch', mascotAura: 'sparks' }, 'pine-forest'),
  scene('galaxy-purple', 'Galaxy Purple', 'Violet prisms over the aurora.', { theme: 'aurora', accent: '#ac7bff', background: 'aurora', surface: 'glass', albumMotion: 'prism', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'orbits', glassFinish: 'prismatic' }, { font: 'future', transition: 'depth', gaugeStyle: 'ring', dockStyle: 'curve', touchFx: 'glow', mascotMotion: 'orbit', mascotAura: 'halo' }, 'galaxy'),
  scene('arctic-ice', 'Arctic Ice', 'Pale mint crystal and a soft glow.', { theme: 'mint', accent: '#36c7ff', background: 'gradient', surface: 'glass', albumMotion: 'glass', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'balanced', dashScene: 'glow', glassFinish: 'frosted' }, { font: 'rounded', transition: 'rise', gaugeStyle: 'arc', dockStyle: 'pill', touchFx: 'ripple', mascotMotion: 'breathe', mascotAura: 'halo' }, 'mountains'),
  scene('ruby-glass', 'Ruby Glass', 'Ember warmth and hologram artwork.', { theme: 'ember', accent: '#ff6b83', background: 'weave', surface: 'glass', albumMotion: 'hologram', depthStyle: 'crystal', motionSpeed: 'calm', effects: 'full', dashScene: 'glow', glassFinish: 'prismatic' }, { font: 'grotesk', transition: 'zoom', gaugeStyle: 'sport', dockStyle: 'island', touchFx: 'glow', mascotMotion: 'pulse', mascotAura: 'glow' }, 'city-lights'),
  scene('copper-retro', 'Copper Retro', 'Coffee and copper with a record playing.', { theme: 'mocha', accent: '#ffb66e', background: 'gradient', surface: 'glass', albumMotion: 'vinyl', depthStyle: 'soft', motionSpeed: 'calm', effects: 'balanced', dashScene: 'glow', glassFinish: 'clear' }, { font: 'grotesk', transition: 'fade', gaugeStyle: 'needle', dockStyle: 'island', touchFx: 'pop', mascotMotion: 'sway', mascotAura: 'smoke' }, 'canyon'),
  scene('hyperdrive', 'Hyperdrive', 'Cyan neon and a perspective laser grid.', { theme: 'midnight', accent: '#38e7ff', background: 'grid', surface: 'neon', albumMotion: 'orbit', depthStyle: 'deep', motionSpeed: 'cinematic', effects: 'full', dashScene: 'grid', glassFinish: 'prismatic' }, { font: 'future', transition: 'zoom', gaugeStyle: 'sport', dockStyle: 'curve', touchFx: 'glow', mascotMotion: 'scan', mascotAura: 'sparks' }, 'tunnel'),

  // --- Looks (v2, unchanged) --------------------------------------------------------------------------------------------------
  look('classic', 'Classic', 'The original: Midnight, solid cards.', { theme: 'midnight', surface: 'solid', background: 'none', shape: 'soft', accent: '#3dd5f3' }),
  look('glass-night', 'Glass Night', 'Frosted cards over the blurred album cover.', { theme: 'midnight', surface: 'glass', background: 'art-blur', shape: 'soft', accent: '#7c9cff' }),
  look('album-immersion', 'Album Immersion', 'True black with the cover art large behind everything.', { theme: 'amoled', surface: 'glass', background: 'art-cover', shape: 'round', accent: '#2f7bff' }),
  look('ambient', 'Ambient', 'Soft colour clouds drawn from the cover.', { theme: 'carbon', surface: 'glass', background: 'art-ambient', shape: 'soft', accent: '#a78bfa' }),
  look('neon-drive', 'Neon Drive', 'Hot pink outlines on a retro grid.', { theme: 'synthwave', surface: 'neon', background: 'grid', shape: 'sharp', accent: '#ff4fd8' }),
  look('sunset-cruise', 'Sunset Cruise', 'Glass over the city lights at dusk.', { theme: 'synthwave', surface: 'glass', background: 'wallpaper', shape: 'round', accent: '#fb923c', wallpaper: 'city-lights' }),
  look('forest-retreat', 'Forest Retreat', 'Deep green glass over slow northern lights.', { theme: 'forest', surface: 'glass', background: 'aurora', shape: 'round', accent: '#4ade80' }),
  look('ocean-deep', 'Ocean Deep', 'Aqua glass over the blurred cover.', { theme: 'ocean', surface: 'glass', background: 'art-blur', shape: 'soft', accent: '#2dd4cf' }),
  look('racing-red', 'Racing Red', 'Red outlines on carbon weave.', { theme: 'crimson', surface: 'outline', background: 'weave', shape: 'sharp', accent: '#ff3b47' }),
  look('gold-standard', 'Gold Standard', 'Black and gold on carbon weave.', { theme: 'royal', surface: 'solid', background: 'weave', shape: 'soft', accent: '#e6b94a' }),
  look('daylight-clean', 'Daylight Clean', 'Bright, calm and plain.', { theme: 'daylight', surface: 'solid', background: 'none', shape: 'soft', accent: '#0f6bb5' }),
  look('paper-glass', 'Paper Glass', 'Warm paper tones with frosted cards.', { theme: 'sand', surface: 'glass', background: 'gradient', shape: 'round', accent: '#b5502d' }),
  look('sun-glare', 'Sun Glare', 'Maximum contrast for direct sunlight.', { theme: 'sunlit', surface: 'solid', background: 'none', shape: 'soft', accent: '#0044cc' }),
  look('night-shift', 'Night Shift', 'High-contrast outlines, nothing to squint at.', { theme: 'contrast', surface: 'outline', background: 'none', shape: 'sharp', accent: '#ffd400' }),
];

/** The settings patch of a preset (a copy, so the caller may add to it). */
export function presetPatch(preset: Preset): PresetPatch {
  return { ...preset.patch };
}

/** The first preset the current settings exactly match, if any (so its tile can show as selected). */
export function activePreset(settings: Settings): Preset | undefined {
  return PRESETS.find((p) => (Object.keys(p.patch) as Array<keyof PresetPatch>).every((k) => settings[k] === p.patch[k]));
}

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
