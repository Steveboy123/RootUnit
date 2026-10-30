/** Generated cover art (SVG data URI) so the demo needs no network and no image files. */
export function cover(seed: number, label: string, round = false): string {
  const h1 = (seed * 67) % 360;
  const h2 = (h1 + 55) % 360;
  const shape = round
    ? `<circle cx="150" cy="150" r="150" fill="url(#g)"/>`
    : `<rect width="300" height="300" fill="url(#g)"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h1} 75% 55%)"/><stop offset="1" stop-color="hsl(${h2} 80% 30%)"/>` +
    `</linearGradient></defs>${shape}` +
    `<circle cx="210" cy="90" r="70" fill="rgba(255,255,255,.14)"/>` +
    `<text x="${round ? 150 : 24}" y="${round ? 175 : 182}" ${round ? 'text-anchor="middle" ' : ''}font-family="sans-serif" font-size="${round ? 90 : 64}" font-weight="700" fill="rgba(255,255,255,.85)">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const initials = (name: string) =>
  name
    .replace(/^the\s+/i, '')
    .split(/[\s&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
