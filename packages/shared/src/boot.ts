/**
 * Boot Studio's vocabulary: the defaults and every allowed choice, shared by the server (which validates and writes the boot files) and
 * the Settings panel (which offers them). v2's values come first in each list, so a saved boot-studio.json keeps working.
 */
export const BOOT_DEFAULTS = {
  preset: 'neon', title: 'HEAD UNIT', subtitle: 'Starting system', readyText: 'Opening head unit',
  bg: 'aurora', bgColor: '#08040f', bgColor2: '#310c2f', accent: '#ff2a93', accent2: '#56d8ff',
  image: 'armored', positionX: 50, positionY: 44, size: 52, opacity: 100, glow: 48,
  motion: 'float', motionSpeed: 50, mirror: false, showMascot: true,
  loader: 'bar', textStyle: 'wide', titleSize: 28, dim: 0, showStatus: true,
  transition: 'fade', transitionMs: 350, backgroundImage: false, particles: true,
} as const;

export type BootConfig = { [K in keyof typeof BOOT_DEFAULTS]: (typeof BOOT_DEFAULTS)[K] extends string ? string : (typeof BOOT_DEFAULTS)[K] extends number ? number : boolean };

export const BOOT_CHOICES = {
  preset: ['neon', 'glass', 'matrix', 'sunset', 'minimal', 'custom', 'hyperdrive', 'vapor', 'blueprint', 'ember', 'plague'],
  bg: ['solid', 'gradient', 'aurora', 'grid', 'image', 'stars', 'warp', 'mesh', 'synthsun'],
  image: ['original', 'transparent', 'armored', 'custom'],
  motion: ['none', 'float', 'pulse', 'tilt', 'orbit', 'hologram', 'glitch', 'breathe', 'spin3d'],
  loader: ['bar', 'ring', 'dots', 'scanner', 'none', 'pulse', 'wave', 'segments', 'orbit', 'heartbeat'],
  textStyle: ['wide', 'clean', 'mono', 'neon', 'glitch', 'outline', 'future'],
  transition: ['none', 'fade', 'zoom', 'slide', 'iris', 'warp', 'shutter'],
} as const;

/** The four colours each ready-made boot theme sets (`custom` keeps whatever the person picked). */
export const BOOT_PRESET_COLOURS: Record<Exclude<(typeof BOOT_CHOICES.preset)[number], 'custom'>, { bgColor: string; bgColor2: string; accent: string; accent2: string }> = {
  neon: { bgColor: '#08040f', bgColor2: '#310c2f', accent: '#ff2a93', accent2: '#56d8ff' },
  glass: { bgColor: '#030b17', bgColor2: '#12385a', accent: '#74ddff', accent2: '#cf8bff' },
  matrix: { bgColor: '#010b05', bgColor2: '#063e24', accent: '#44ff88', accent2: '#18dcc7' },
  sunset: { bgColor: '#15070c', bgColor2: '#663019', accent: '#ff9a46', accent2: '#ff438e' },
  minimal: { bgColor: '#08090c', bgColor2: '#24272e', accent: '#eeeeee', accent2: '#9899a9' },
  hyperdrive: { bgColor: '#02040c', bgColor2: '#0b1f4a', accent: '#38e7ff', accent2: '#8b5cff' },
  vapor: { bgColor: '#12052e', bgColor2: '#4a0f5c', accent: '#ff2bd6', accent2: '#3ce8ff' },
  blueprint: { bgColor: '#061a33', bgColor2: '#0a2a5e', accent: '#7fe3ff', accent2: '#ffffff' },
  ember: { bgColor: '#0d0504', bgColor2: '#4a1608', accent: '#fb923c', accent2: '#ffd166' },
  plague: { bgColor: '#050206', bgColor2: '#3a0a2a', accent: '#ff2a93', accent2: '#c218ff' },
};
