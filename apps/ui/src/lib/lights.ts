import type { LightingMode, LightingState } from '@headunit/shared';

/** WLED brightness is 1-255; people think in percent. 1 is the floor: 0 would be "off", which has its own switch. */
export const briToPercent = (bri: number) => Math.max(1, Math.min(100, Math.round((bri / 255) * 100)));
export const percentToBri = (pct: number) => Math.max(1, Math.min(255, Math.round((pct / 100) * 255)));

export const COLOR_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Ice blue', hex: '#30a5ff' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Magenta', hex: '#e8409a' },
  { name: 'Red', hex: '#ff2d2d' },
  { name: 'Orange', hex: '#ff8a1f' },
  { name: 'Warm white', hex: '#ffc477' },
  { name: 'Green', hex: '#22d36b' },
  { name: 'Cyan', hex: '#16d9d0' },
];

/** `#RRGGBB` in lower case from what was typed (the `#` is optional, three-digit shorthand is expanded), or null. */
export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

/**
 * The same rule the server applies to the ESP's address: a private IPv4 address (10.x, 172.16-31.x, 192.168.x), not a name and
 * not an internet address. Checked here as well only so the mistake is explained before the round trip. Empty clears the address.
 */
export function checkLightsHost(host: string): string | null {
  const h = host.trim();
  if (h === '') return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return 'Enter the numbers the ESP shows, like 192.168.1.50. A name or web address will not work.';
  const [a = 0, b = 0, c = 0, d = 0] = m.slice(1).map(Number);
  if ([a, b, c, d].some((v) => v > 255) || d === 0 || d === 255) return 'That is not a usable address. Each number is between 0 and 255.';
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!isPrivate) return 'The lights must be on your own private Wi-Fi (starting 192.168, 10. or 172.16–31.).';
  return null;
}

export interface EffectItem {
  index: number;
  name: string;
}

/** WLED lists unused slots as "RSVD" and unavailable ones as "-"; those cannot be chosen. The index is the effect number to send. */
export function listEffects(names: readonly string[], query = ''): EffectItem[] {
  const q = query.trim().toLowerCase();
  const out: EffectItem[] = [];
  names.forEach((name, index) => {
    const n = name.trim();
    if (!n || n === '-' || n === 'RSVD') return;
    if (q && !n.toLowerCase().includes(q)) return;
    out.push({ index, name: n });
  });
  return out;
}

export const MODE_INFO: Record<LightingMode, { label: string; hint: string }> = {
  manual: { label: 'Colour', hint: 'One colour you choose, or an effect.' },
  'esp-audio': { label: 'ESP mic', hint: 'The ESP32’s own microphone moves the lights to the sound in the car.' },
  'pi-audio': { label: 'Music', hint: 'The head unit’s own audio drives the lights. Needs the Pi’s audio monitor (parec).' },
};

/**
 * "Match the screen": the colour to send to the lights now, or null to send nothing. Only in the plain-colour mode (an effect or a
 * music mode is the owner's choice and is left alone), only to lights that are set up and on, and never the colour they already have
 * or the one sent last (so a quiet screen sends nothing at all).
 */
export function followColor(input: { on: boolean; lights: Pick<LightingState, 'configured' | 'enabled' | 'mode' | 'color'> | null | undefined; accent: string; lastSent: string }): string | null {
  const { on, lights, accent, lastSent } = input;
  if (!on || !lights || !lights.configured || !lights.enabled || lights.mode !== 'manual') return null;
  const hex = normalizeHex(accent);
  if (!hex || hex === lastSent || hex === normalizeHex(lights.color)) return null;
  return hex;
}
