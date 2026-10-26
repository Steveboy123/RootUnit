import type { BuiltinWallpaper } from '@headunit/shared';

/**
 * Built-in wallpapers: twenty scenes drawn as inline SVG (nothing to ship or download, no text). Every scene is 1600×900 with
 * `preserveAspectRatio="xMidYMid slice"`, so it fills any screen like `object-fit: cover`. Repeated details (stars, windows, trees) come
 * from a seeded random generator, so a scene is the same picture on every boot and its analysis can be cached.
 */

export const WALLPAPER_LABELS: Record<BuiltinWallpaper, string> = {
  'night-road': 'Night road',
  'city-lights': 'City lights',
  mountains: 'Mountains',
  dunes: 'Dunes',
  waves: 'Waves',
  'neon-city': 'Neon city',
  galaxy: 'Galaxy',
  'pine-forest': 'Pine forest',
  'coast-road': 'Coast road',
  canyon: 'Canyon',
  tunnel: 'Tunnel',
  'race-track': 'Race track',
  'aurora-lake': 'Aurora lake',
  'synth-sunset': 'Synthwave sunset',
  'ice-peaks': 'Ice peaks',
  'liquid-chrome': 'Liquid chrome',
  'phantom-smoke': 'Phantom smoke',
  eclipse: 'Eclipse',
  'vinyl-lounge': 'Vinyl lounge',
  'sunset-gt': 'Sunset GT',
};

/** Mulberry32: a tiny deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function stars(seed: number, n: number, maxY: number, fill = '#fff'): string {
  const rand = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const r = rand() < 0.08 ? 2 : rand() < 0.4 ? 1.3 : 0.8;
    out += `<circle cx="${r1(rand() * 1600)}" cy="${r1(rand() * maxY)}" r="${r}" fill="${fill}" opacity="${r1(0.35 + rand() * 0.6)}"/>`;
  }
  return out;
}

/** A jagged ridge line from x=0 to 1600 around `baseY`, filled to the bottom. */
function ridge(seed: number, baseY: number, amp: number, step: number, fill: string, opacity = 1): string {
  const rand = rng(seed);
  let d = `M0 900 L0 ${baseY}`;
  for (let x = 0; x <= 1600; x += step) d += ` L${x} ${r1(baseY - rand() * amp)}`;
  d += ' L1600 900 Z';
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

/** A smooth wave band (quadratic curves). */
function wave(baseY: number, amp: number, len: number, phase: number, fill: string, opacity = 1): string {
  let d = `M0 900 L0 ${baseY}`;
  for (let x = 0; x <= 1600 + len; x += len) {
    const up = (Math.round(x / len) + phase) % 2 === 0;
    d += ` Q${x + len / 2} ${baseY + (up ? -amp : amp)} ${x + len} ${baseY}`;
  }
  d += ' L1600 900 Z';
  return `<path d="${d}" fill="${fill}" opacity="${opacity}"/>`;
}

function pines(seed: number, n: number, baseY: number, h: number, fill: string): string {
  const rand = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r1(rand() * 1660 - 30);
    const th = h * (0.6 + rand() * 0.6);
    const w = th * 0.32;
    const y = baseY + rand() * 18;
    out += `<path d="M${x} ${r1(y - th)} L${r1(x + w / 2)} ${r1(y)} L${r1(x - w / 2)} ${r1(y)} Z" fill="${fill}"/>`;
  }
  return out;
}

function skyline(seed: number, baseY: number, n: number, minH: number, maxH: number, fill: string, lit: string, litChance: number): string {
  const rand = rng(seed);
  let out = '';
  let x = -20;
  for (let i = 0; i < n && x < 1620; i++) {
    const w = 40 + rand() * 90;
    const h = minH + rand() * (maxH - minH);
    out += `<rect x="${r1(x)}" y="${r1(baseY - h)}" width="${r1(w)}" height="${r1(h + 40)}" fill="${fill}"/>`;
    for (let wy = baseY - h + 12; wy < baseY - 10; wy += 16) {
      for (let wx = x + 8; wx < x + w - 10; wx += 13) {
        if (rand() < litChance) out += `<rect x="${r1(wx)}" y="${r1(wy)}" width="5" height="7" fill="${lit}" opacity="${r1(0.5 + rand() * 0.5)}"/>`;
      }
    }
    x += w + rand() * 8;
  }
  return out;
}

/** A palm tree silhouette: a curved trunk and drooping fronds. */
function palm(x: number, baseY: number, h: number, lean: number, fill: string): string {
  const top = { x: x + lean, y: baseY - h };
  let out = `<path d="M${x - 7} ${baseY} Q${x + lean * 0.2} ${baseY - h * 0.5} ${top.x - 3} ${top.y} L${top.x + 3} ${top.y} Q${x + lean * 0.2 + 8} ${baseY - h * 0.5} ${x + 7} ${baseY} Z" fill="${fill}"/>`;
  for (const [dx, dy, bend] of [[-1, 0.15, 1], [-0.8, -0.25, 1], [1, 0.1, -1], [0.85, -0.3, -1], [-0.2, -0.45, 1], [0.3, 0.4, -1]] as const) {
    const ex = top.x + dx * h * 0.42;
    const ey = top.y + dy * h * 0.3 + h * 0.08;
    out += `<path d="M${top.x} ${top.y} Q${r1((top.x + ex) / 2 + bend * 10)} ${r1(top.y - h * 0.12)} ${r1(ex)} ${r1(ey)} Q${r1((top.x + ex) / 2)} ${r1(top.y - h * 0.04)} ${top.x} ${top.y + 6} Z" fill="${fill}"/>`;
  }
  return out;
}

/** A low sports car from behind, two red tail lights. */
function car(cx: number, baseY: number, w: number, body: string, light: string): string {
  const h = w * 0.3;
  return (
    `<path d="M${cx - w / 2} ${baseY} L${cx - w / 2} ${r1(baseY - h * 0.55)} Q${cx - w * 0.42} ${r1(baseY - h * 0.75)} ${cx - w * 0.28} ${r1(baseY - h * 0.78)} L${cx - w * 0.18} ${r1(baseY - h)} L${cx + w * 0.18} ${r1(baseY - h)} L${cx + w * 0.28} ${r1(baseY - h * 0.78)} Q${cx + w * 0.42} ${r1(baseY - h * 0.75)} ${cx + w / 2} ${r1(baseY - h * 0.55)} L${cx + w / 2} ${baseY} Z" fill="${body}"/>` +
    `<rect x="${r1(cx - w * 0.46)}" y="${r1(baseY - h * 0.5)}" width="${r1(w * 0.26)}" height="${r1(h * 0.1)}" rx="3" fill="${light}"/>` +
    `<rect x="${r1(cx + w * 0.2)}" y="${r1(baseY - h * 0.5)}" width="${r1(w * 0.26)}" height="${r1(h * 0.1)}" rx="3" fill="${light}"/>` +
    `<ellipse cx="${cx}" cy="${r1(baseY + 4)}" rx="${r1(w * 0.55)}" ry="8" fill="${light}" opacity="0.25"/>`
  );
}

/** A neon perspective grid floor from the horizon at `y` down to the bottom. */
function grid(y: number, colour: string): string {
  let out = '';
  for (let i = -14; i <= 14; i++) out += `<path d="M${800 + i * 30} ${y} L${800 + i * 190} 900" stroke="${colour}" stroke-width="2" opacity="0.7"/>`;
  for (let k = 0; k < 9; k++) {
    const t = (k + 1) / 9;
    out += `<path d="M0 ${r1(y + t * t * (900 - y))} H1600" stroke="${colour}" stroke-width="${r1(1 + t * 2)}" opacity="${r1(0.35 + t * 0.5)}"/>`;
  }
  return out;
}

const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;

const lin = (id: string, stops: Array<[number, string]>, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const rad = (id: string, stops: Array<[number, string, number?]>, cx = 0.5, cy = 0.5, r = 0.5) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;

const SCENES: Record<BuiltinWallpaper, () => string> = {
  'night-road': () =>
    svg(
      lin('s', [[0, '#050816'], [0.55, '#18214a'], [0.7, '#3b2a5a']]) + rad('h', [[0, '#ff9a5a', 0.55], [1, '#ff9a5a', 0]], 0.5, 0.66, 0.4) + lin('r', [[0, '#1b1d2b'], [1, '#07080d']]),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(11, 160, 480)}<rect width="1600" height="900" fill="url(#h)"/>` +
        ridge(12, 600, 120, 80, '#120f24') +
        `<path d="M640 600 L960 600 L1600 900 L0 900 Z" fill="url(#r)"/>` +
        Array.from({ length: 9 }, (_, i) => {
          const t = i / 9;
          const y = 606 + t * t * 300;
          const w = 3 + t * 18;
          return `<rect x="${r1(800 - w / 2)}" y="${r1(y)}" width="${r1(w)}" height="${r1(6 + t * 34)}" fill="#ffd27a" opacity="0.85"/>`;
        }).join('') +
        `<path d="M640 600 L0 900" stroke="#ff5a6e" stroke-width="3" opacity="0.6"/><path d="M960 600 L1600 900" stroke="#ff5a6e" stroke-width="3" opacity="0.6"/>`,
    ),
  'city-lights': () =>
    svg(
      lin('s', [[0, '#1a0b33'], [0.5, '#5b2a6e'], [0.78, '#e0745a'], [1, '#f8b26a']]) + lin('w', [[0, '#2a1640'], [1, '#0a0614']]),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(21, 60, 300)}` +
        skyline(22, 700, 40, 120, 340, '#24123a', '#ffcf7a', 0.25) +
        skyline(23, 740, 40, 60, 220, '#140a24', '#ffd98a', 0.4) +
        `<rect y="740" width="1600" height="160" fill="url(#w)"/>` +
        Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 41) % 1600}" y="${760 + (i % 7) * 18}" width="${20 + (i % 5) * 9}" height="2" fill="#ffcf7a" opacity="0.4"/>`).join(''),
    ),
  mountains: () =>
    svg(
      lin('s', [[0, '#0b1a33'], [0.6, '#2f5b8a'], [1, '#9cc3e0']]) + rad('m', [[0, '#fff8e0'], [0.6, '#fff8e0', 0.15], [1, '#fff8e0', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(31, 70, 300)}<circle cx="1180" cy="190" r="140" fill="url(#m)"/><circle cx="1180" cy="190" r="46" fill="#fffbe9"/>` +
        ridge(32, 520, 220, 70, '#3c5f86', 0.9) +
        `<rect y="560" width="1600" height="60" fill="#cfe2f2" opacity="0.18"/>` +
        ridge(33, 640, 180, 60, '#22405f') +
        `<rect y="680" width="1600" height="40" fill="#cfe2f2" opacity="0.12"/>` +
        ridge(34, 760, 140, 50, '#11243a') +
        ridge(35, 860, 80, 40, '#08131f'),
    ),
  dunes: () =>
    svg(
      lin('s', [[0, '#f4a55a'], [0.55, '#ffd59a'], [1, '#ffe9c4']]) + rad('u', [[0, '#fff3d0'], [0.5, '#fff3d0', 0.35], [1, '#fff3d0', 0]], 0.5, 0.5, 0.5) + lin('d1', [[0, '#d9823e'], [1, '#a65424']]) + lin('d2', [[0, '#b9622a'], [1, '#6e3014']]),
      `<rect width="1600" height="900" fill="url(#s)"/><circle cx="460" cy="360" r="220" fill="url(#u)"/><circle cx="460" cy="360" r="70" fill="#fff6dc"/>` +
        `<path d="M0 620 Q400 520 760 600 T1600 560 L1600 900 L0 900 Z" fill="url(#d1)"/>` +
        `<path d="M0 760 Q520 640 900 720 T1600 700 L1600 900 L0 900 Z" fill="url(#d2)"/>` +
        `<path d="M0 860 Q600 780 1100 840 T1600 820 L1600 900 L0 900 Z" fill="#4a1e0c"/>`,
    ),
  waves: () =>
    svg(
      lin('s', [[0, '#2a1b4a'], [0.45, '#d8648a'], [0.62, '#ffb48a']]) + lin('o', [[0, '#3a5f9a'], [1, '#0b1630']]),
      `<rect width="1600" height="900" fill="url(#s)"/><circle cx="800" cy="520" r="120" fill="#ffd9a8" opacity="0.9"/><rect y="520" width="1600" height="380" fill="url(#o)"/>` +
        Array.from({ length: 10 }, (_, i) => `<rect x="${720 - i * 14}" y="${540 + i * 22}" width="${160 + i * 28}" height="4" fill="#ffd9a8" opacity="${r1(0.6 - i * 0.05)}"/>`).join('') +
        wave(640, 18, 160, 0, '#22427a', 0.8) +
        wave(720, 24, 200, 1, '#162f5c', 0.9) +
        wave(800, 28, 240, 0, '#0c1f40') +
        wave(860, 20, 180, 1, '#06122a'),
    ),
  'neon-city': () =>
    svg(
      lin('s', [[0, '#05030f'], [0.6, '#1a0a35'], [1, '#3a0d4a']]) + rad('g', [[0, '#ff2a93', 0.45], [1, '#ff2a93', 0]], 0.5, 0.8, 0.6),
      `<rect width="1600" height="900" fill="url(#s)"/><rect width="1600" height="900" fill="url(#g)"/>` +
        skyline(61, 760, 40, 200, 520, '#0d0620', '#56d8ff', 0.18) +
        skyline(62, 820, 40, 120, 340, '#07030f', '#ff5ab4', 0.22) +
        `<rect x="260" y="330" width="12" height="160" fill="#ff2a93"/><rect x="980" y="280" width="140" height="10" fill="#56d8ff"/><rect x="1300" y="420" width="10" height="120" fill="#f3e600"/><rect x="560" y="470" width="120" height="8" fill="#56d8ff"/>` +
        `<rect y="820" width="1600" height="80" fill="#05020c"/>` +
        Array.from({ length: 60 }, (_, i) => {
          const rand = rng(63 + i);
          return `<rect x="${r1(rand() * 1600)}" y="${r1(rand() * 900)}" width="1.5" height="${r1(30 + rand() * 50)}" fill="#a8d8ff" opacity="0.18"/>`;
        }).join(''),
    ),
  galaxy: () =>
    svg(
      rad('n1', [[0, '#b04aff', 0.7], [0.5, '#5a2ad0', 0.3], [1, '#000', 0]], 0.5, 0.5, 0.5) + rad('n2', [[0, '#ff4fa3', 0.6], [1, '#ff4fa3', 0]], 0.5, 0.5, 0.5) + rad('n3', [[0, '#3ad0ff', 0.5], [1, '#3ad0ff', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="#030212"/>${stars(71, 360, 900)}` +
        `<ellipse cx="820" cy="430" rx="620" ry="190" fill="url(#n1)" transform="rotate(-18 820 430)"/>` +
        `<ellipse cx="560" cy="520" rx="320" ry="120" fill="url(#n2)" transform="rotate(-24 560 520)"/>` +
        `<ellipse cx="1120" cy="330" rx="300" ry="110" fill="url(#n3)" transform="rotate(-12 1120 330)"/>` +
        `<ellipse cx="820" cy="430" rx="90" ry="40" fill="#fff4ff" opacity="0.65" transform="rotate(-18 820 430)"/>${stars(72, 120, 900, '#ffe9ff')}`,
    ),
  'pine-forest': () =>
    svg(
      lin('s', [[0, '#9fb8b0'], [0.5, '#d5e2d6'], [1, '#e9efe4']]),
      `<rect width="1600" height="900" fill="url(#s)"/><circle cx="1240" cy="220" r="70" fill="#fffdf0" opacity="0.8"/>` +
        pines(81, 70, 520, 220, '#7d9a8e') +
        `<rect y="470" width="1600" height="120" fill="#e2ebe2" opacity="0.5"/>` +
        pines(82, 60, 680, 300, '#4a6b5d') +
        `<rect y="640" width="1600" height="100" fill="#dfe8dd" opacity="0.35"/>` +
        pines(83, 40, 900, 420, '#1f3a2f'),
    ),
  'coast-road': () =>
    svg(
      lin('s', [[0, '#3a2f6a'], [0.45, '#f08a5d'], [0.7, '#ffd08a']]) + lin('sea', [[0, '#2f6d9a'], [1, '#0c2b4a']]),
      `<rect width="1600" height="900" fill="url(#s)"/><circle cx="1220" cy="470" r="90" fill="#fff0c8"/><rect y="500" width="1600" height="400" fill="url(#sea)"/>` +
        Array.from({ length: 8 }, (_, i) => `<rect x="${1140 - i * 12}" y="${520 + i * 20}" width="${160 + i * 24}" height="4" fill="#ffe1a8" opacity="${r1(0.55 - i * 0.05)}"/>`).join('') +
        `<path d="M0 420 L180 380 L320 440 L420 420 L560 520 L720 900 L0 900 Z" fill="#3b2a2a"/>` +
        `<path d="M0 520 L260 500 L420 560 L560 640 L760 900 L0 900 Z" fill="#251818"/>` +
        `<path d="M300 900 Q480 640 660 560 L700 580 Q540 660 420 900 Z" fill="#454552"/>` +
        `<path d="M372 900 Q520 690 680 572" stroke="#ffe08a" stroke-width="4" stroke-dasharray="26 22" fill="none"/>`,
    ),
  canyon: () =>
    svg(
      lin('s', [[0, '#f6c08a'], [0.6, '#ffe2bb'], [1, '#ffe9cc']]) + lin('c1', [[0, '#d2693a'], [1, '#8d3a1c']]) + lin('c2', [[0, '#a8431e'], [1, '#5a1f0c']]),
      `<rect width="1600" height="900" fill="url(#s)"/>` +
        `<path d="M0 360 L240 360 L260 420 L420 420 L440 380 L560 380 L600 900 L0 900 Z" fill="url(#c1)"/>` +
        `<path d="M1600 300 L1340 300 L1320 360 L1160 360 L1140 420 L1020 420 L980 900 L1600 900 Z" fill="url(#c1)"/>` +
        `<path d="M0 560 L320 540 L380 600 L520 600 L640 900 L0 900 Z" fill="url(#c2)"/>` +
        `<path d="M1600 520 L1260 520 L1220 580 L1080 600 L960 900 L1600 900 Z" fill="url(#c2)"/>` +
        `<path d="M700 900 Q770 760 788 640 L816 640 Q840 760 930 900 Z" fill="#4f8aa0"/><path d="M760 900 Q790 760 800 660" stroke="#bfe6f0" stroke-width="3" fill="none" opacity="0.5"/>` +
        `<rect y="410" width="1600" height="6" fill="#ffd1a0" opacity="0.4"/>`,
    ),
  tunnel: () =>
    svg(
      rad('t', [[0, '#ffcf7a', 0.9], [0.25, '#ff8a3c', 0.35], [1, '#120806', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="#0b0605"/>` +
        Array.from({ length: 10 }, (_, i) => {
          const k = 1 - i / 10;
          const w = 1600 * k * k + 80;
          const h = 900 * k * k + 50;
          return `<rect x="${r1(800 - w / 2)}" y="${r1(440 - h / 2)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h * 0.45)}" fill="none" stroke="#2a1a14" stroke-width="${r1(2 + k * 14)}"/>`;
        }).join('') +
        `<ellipse cx="800" cy="440" rx="260" ry="160" fill="url(#t)"/>` +
        Array.from({ length: 14 }, (_, i) => {
          const k = (i + 1) / 14;
          const y = 440 - 380 * k * k;
          const dx = 700 * k * k;
          const s = 3 + 14 * k * k;
          return `<rect x="${r1(800 - dx - s)}" y="${r1(y)}" width="${r1(s * 2)}" height="${r1(s * 0.6)}" fill="#ffc06a" opacity="0.9"/><rect x="${r1(800 + dx - s)}" y="${r1(y)}" width="${r1(s * 2)}" height="${r1(s * 0.6)}" fill="#ffc06a" opacity="0.9"/>`;
        }).join('') +
        `<path d="M760 440 L840 440 L1400 900 L200 900 Z" fill="#17100d"/><path d="M800 440 L800 900" stroke="#ffd27a" stroke-width="6" stroke-dasharray="30 40" opacity="0.6"/>`,
    ),
  'race-track': () =>
    svg(
      lin('s', [[0, '#04060f'], [1, '#141a30']]) + rad('l', [[0, '#e8f0ff', 0.55], [1, '#e8f0ff', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(91, 80, 300)}` +
        [200, 700, 1300].map((x) => `<circle cx="${x}" cy="160" r="160" fill="url(#l)"/><rect x="${x - 4}" y="160" width="8" height="420" fill="#2a3044"/><rect x="${x - 40}" y="150" width="80" height="18" fill="#f4f8ff"/>`).join('') +
        `<path d="M0 640 Q700 520 1600 600 L1600 900 L0 900 Z" fill="#0c0f1a"/>` +
        `<path d="M-40 900 Q600 600 1640 640 L1640 760 Q700 740 260 900 Z" fill="#2b2f3c"/>` +
        Array.from({ length: 24 }, (_, i) => {
          const t = i / 24;
          const x = -40 + 1680 * t;
          const y = 900 - 260 * Math.sin(Math.min(1, t * 1.6)) + (t > 0.62 ? (t - 0.62) * 0 : 0);
          return `<rect x="${r1(x)}" y="${r1(y - 8 + t * 4)}" width="70" height="10" fill="${i % 2 ? '#f4f4f4' : '#e8303e'}" transform="rotate(${r1(-14 + t * 16)} ${r1(x)} ${r1(y)})"/>`;
        }).join('') +
        `<path d="M300 900 Q700 700 1640 700" stroke="#f4f4f4" stroke-width="3" stroke-dasharray="40 30" fill="none" opacity="0.5"/>`,
    ),
  'aurora-lake': () =>
    svg(
      lin('s', [[0, '#020617'], [0.6, '#0b2440'], [1, '#14365a']]) +
        rad('a', [[0, '#41ffb5', 0.65], [0.6, '#22c9a0', 0.2], [1, '#000', 0]], 0.5, 0.6, 0.5) +
        rad('b', [[0, '#a66bff', 0.55], [1, '#a66bff', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(101, 140, 420)}` +
        `<ellipse cx="620" cy="250" rx="560" ry="150" fill="url(#a)" transform="rotate(-8 620 250)"/>` +
        `<ellipse cx="1160" cy="200" rx="420" ry="120" fill="url(#b)" transform="rotate(10 1160 200)"/>` +
        `<ellipse cx="900" cy="330" rx="520" ry="90" fill="url(#a)" opacity="0.6"/>` +
        ridge(102, 560, 90, 60, '#06121d') +
        pines(103, 50, 600, 120, '#030a12') +
        `<rect y="600" width="1600" height="300" fill="#04101c"/>` +
        `<ellipse cx="620" cy="760" rx="520" ry="80" fill="url(#a)" opacity="0.35"/><ellipse cx="1160" cy="790" rx="380" ry="60" fill="url(#b)" opacity="0.3"/>` +
        Array.from({ length: 16 }, (_, i) => `<rect x="${(i * 97) % 1600}" y="${640 + i * 15}" width="${120 + (i % 4) * 40}" height="2" fill="#bfeee0" opacity="0.18"/>`).join(''),
    ),
  'synth-sunset': () =>
    svg(
      lin('s', [[0, '#12052e'], [0.45, '#4a0f5c'], [0.62, '#c2186b'], [0.66, '#ff6a3d']]) +
        lin('sun', [[0, '#ffe36a'], [0.5, '#ff8a3d'], [1, '#ff2a85']]) +
        lin('f', [[0, '#1a0430'], [1, '#05010d']]) +
        rad('g', [[0, '#ff2a85', 0.55], [1, '#ff2a85', 0]], 0.5, 0.62, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(111, 90, 320)}<rect width="1600" height="900" fill="url(#g)"/>` +
        `<clipPath id="cut">${Array.from({ length: 12 }, (_, i) => `<rect x="560" y="${180 + i * 30}" width="480" height="${r1(30 - (i > 6 ? (i - 6) * 3 : 0))}"/>`).join('')}</clipPath>` +
        `<circle cx="800" cy="420" r="230" fill="url(#sun)" clip-path="url(#cut)"/>` +
        ridge(112, 560, 110, 70, '#2b0a46') +
        ridge(113, 600, 60, 50, '#1a0533') +
        `<rect y="600" width="1600" height="300" fill="url(#f)"/>${grid(600, '#ff2bd6')}` +
        `<path d="M600 600 L1000 600 L1300 900 L300 900 Z" fill="#0a0216" opacity="0.85"/>` +
        `<path d="M600 600 L300 900" stroke="#3ce8ff" stroke-width="3"/><path d="M1000 600 L1300 900" stroke="#3ce8ff" stroke-width="3"/>` +
        palm(150, 640, 300, 40, '#0b0218') +
        palm(300, 620, 220, -30, '#0d0320') +
        palm(1420, 640, 320, -50, '#0b0218') +
        palm(1290, 615, 200, 20, '#0d0320') +
        car(840, 830, 300, '#06010e', '#ff2a4a'),
    ),
  'ice-peaks': () =>
    svg(
      lin('s', [[0, '#020a1c'], [0.55, '#0c2a52'], [1, '#1d5a8f']]) +
        lin('ice', [[0, '#e8f6ff'], [0.4, '#8fd3ff'], [1, '#1b4f86']]) +
        lin('lake', [[0, '#0b3a66'], [1, '#020a1c']]) +
        rad('glow', [[0, '#5ad1ff', 0.55], [1, '#5ad1ff', 0]], 0.5, 0.55, 0.55),
      `<rect width="1600" height="900" fill="url(#s)"/>${stars(121, 150, 400, '#cfefff')}<rect width="1600" height="900" fill="url(#glow)"/>` +
        `<path d="M0 640 L180 380 L290 470 L460 220 L610 430 L760 300 L900 470 L1080 180 L1240 400 L1380 290 L1600 520 L1600 640 Z" fill="url(#ice)" opacity="0.92"/>` +
        `<path d="M460 220 L520 640 L380 640 Z M1080 180 L1140 640 L990 640 Z M760 300 L800 640 L700 640 Z" fill="#ffffff" opacity="0.28"/>` +
        `<path d="M0 640 L200 520 L360 600 L520 500 L700 610 L900 530 L1100 620 L1300 520 L1600 600 L1600 640 Z" fill="#0d3a66" opacity="0.9"/>` +
        `<rect y="640" width="1600" height="260" fill="url(#lake)"/>` +
        `<path d="M0 640 L180 820 L290 760 L460 900 L610 780 L760 860 L900 760 L1080 900 L1240 780 L1380 840 L1600 700 L1600 640 Z" fill="url(#ice)" opacity="0.18"/>` +
        Array.from({ length: 22 }, (_, i) => `<rect x="${(i * 131) % 1600}" y="${660 + (i % 11) * 20}" width="${80 + (i % 5) * 50}" height="2" fill="#bfe9ff" opacity="0.25"/>`).join(''),
    ),
  'liquid-chrome': () =>
    svg(
      lin('bg', [[0, '#0a0b0e'], [1, '#22252b']]) +
        lin('c1', [[0, '#1b1d22'], [0.35, '#f4f6fa'], [0.5, '#6b7280'], [0.7, '#e6e9ef'], [1, '#14161a']], false) +
        lin('c2', [[0, '#e9ecf2'], [0.3, '#30343c'], [0.6, '#cfd4dc'], [1, '#0f1114']], false) +
        rad('hi', [[0, '#ffffff', 0.5], [1, '#ffffff', 0]], 0.3, 0.3, 0.5),
      `<rect width="1600" height="900" fill="url(#bg)"/>` +
        `<path d="M-100 520 C200 300 420 760 760 520 S1300 160 1700 420 L1700 700 C1300 420 1000 900 640 720 S120 640 -100 820 Z" fill="url(#c1)"/>` +
        `<path d="M-100 240 C260 40 520 420 880 260 S1420 -40 1700 140 L1700 330 C1360 120 1120 520 760 420 S160 300 -100 430 Z" fill="url(#c2)" opacity="0.92"/>` +
        `<path d="M-100 820 C300 700 640 960 1000 800 S1500 640 1700 760 L1700 900 L-100 900 Z" fill="url(#c2)" opacity="0.85"/>` +
        `<rect width="1600" height="900" fill="url(#hi)"/>` +
        `<path d="M-100 520 C200 300 420 760 760 520 S1300 160 1700 420" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.5"/>`,
    ),
  'phantom-smoke': () =>
    svg(
      lin('s', [[0, '#050206'], [1, '#12030f']]) +
        rad('p1', [[0, '#ff1f8f', 0.7], [0.5, '#a3135f', 0.25], [1, '#000', 0]], 0.5, 0.5, 0.5) +
        rad('p2', [[0, '#c218ff', 0.5], [1, '#000', 0]], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/>` +
        `<ellipse cx="1180" cy="380" rx="520" ry="300" fill="url(#p1)"/>` +
        `<ellipse cx="420" cy="720" rx="560" ry="200" fill="url(#p2)" opacity="0.6"/>` +
        `<ellipse cx="900" cy="820" rx="700" ry="160" fill="url(#p1)" opacity="0.45"/>` +
        Array.from({ length: 7 }, (_, i) => `<path d="M${-100 + i * 260} ${700 - (i % 3) * 60} C${100 + i * 260} ${560 - (i % 2) * 80} ${300 + i * 240} ${760} ${520 + i * 230} ${620 - (i % 3) * 40}" stroke="#ff4fb0" stroke-width="${18 + (i % 3) * 10}" fill="none" opacity="0.08" stroke-linecap="round"/>`).join('') +
        stars(131, 120, 900, '#ff7ac2') +
        `<circle cx="1180" cy="380" r="2" fill="#fff" opacity="0.6"/>`,
    ),
  eclipse: () =>
    svg(
      rad('c', [[0, '#000', 1], [0.42, '#000', 1], [0.46, '#fff4e0', 1], [0.52, '#ffb27a', 0.6], [0.75, '#7a3cff', 0.18], [1, '#000', 0]], 0.5, 0.5, 0.5) +
        rad('v', [[0, '#1a1030', 0.6], [1, '#000', 0]], 0.5, 0.45, 0.7),
      `<rect width="1600" height="900" fill="#000"/><rect width="1600" height="900" fill="url(#v)"/>${stars(141, 220, 900, '#dfe6ff')}` +
        `<circle cx="1050" cy="380" r="330" fill="url(#c)"/>` +
        `<circle cx="1050" cy="380" r="139" fill="#000"/>` +
        `<path d="M760 600 Q1050 520 1340 600" stroke="#ffb27a" stroke-width="2" fill="none" opacity="0.25"/>`,
    ),
  'vinyl-lounge': () =>
    svg(
      lin('s', [[0, '#120804'], [1, '#2a1408']]) +
        rad('lamp', [[0, '#ffb35a', 0.65], [1, '#ffb35a', 0]], 0.2, 0.25, 0.55) +
        rad('rec', [[0, '#f2c27a'], [0.16, '#c2532b'], [0.17, '#0b0806'], [1, '#141010']], 0.5, 0.5, 0.5),
      `<rect width="1600" height="900" fill="url(#s)"/><rect width="1600" height="900" fill="url(#lamp)"/>` +
        `<circle cx="1080" cy="470" r="380" fill="url(#rec)"/>` +
        Array.from({ length: 22 }, (_, i) => `<circle cx="1080" cy="470" r="${80 + i * 13.5}" fill="none" stroke="#2c2420" stroke-width="1.4" opacity="0.8"/>`).join('') +
        `<path d="M760 250 A380 380 0 0 1 1180 110" stroke="#fff3dc" stroke-width="10" fill="none" opacity="0.12"/>` +
        `<circle cx="1080" cy="470" r="9" fill="#120804"/>` +
        `<rect x="0" y="780" width="1600" height="120" fill="#0c0603"/>` +
        Array.from({ length: 9 }, (_, i) => `<rect x="${120 + i * 46}" y="${560 + (i % 3) * 12}" width="34" height="${220 - (i % 3) * 12}" rx="3" fill="${['#7a2e1b', '#b8692c', '#3b2a22', '#d39a4a'][i % 4]}" opacity="0.85"/>`).join(''),
    ),
  'sunset-gt': () =>
    svg(
      lin('s', [[0, '#1d0b2b'], [0.35, '#7a1f3d'], [0.6, '#ff6a2b'], [0.72, '#ffc15a']]) +
        rad('sun', [[0, '#fff1c2'], [0.5, '#ffb347'], [1, '#ff6a2b', 0]], 0.5, 0.5, 0.5) +
        lin('r', [[0, '#2a1416'], [1, '#07050a']]),
      `<rect width="1600" height="900" fill="url(#s)"/>` +
        `<circle cx="800" cy="560" r="200" fill="url(#sun)"/>` +
        ridge(151, 600, 140, 90, '#4a1424', 0.9) +
        ridge(152, 620, 70, 60, '#2a0a18') +
        `<rect y="620" width="1600" height="280" fill="#150810"/>` +
        `<path d="M760 620 L840 620 L1250 900 L350 900 Z" fill="url(#r)"/>` +
        Array.from({ length: 8 }, (_, i) => {
          const t = i / 8;
          const y = 626 + t * t * 270;
          const w = 2 + t * 14;
          return `<rect x="${r1(800 - w / 2)}" y="${r1(y)}" width="${r1(w)}" height="${r1(5 + t * 30)}" fill="#ffd27a" opacity="0.85"/>`;
        }).join('') +
        car(800, 840, 380, '#0a0508', '#ff3a3a'),
    ),
};

const cache = new Map<BuiltinWallpaper, string>();

/** The SVG source of a built-in scene. */
export function wallpaperSvg(id: BuiltinWallpaper): string {
  let s = cache.get(id);
  if (!s) {
    s = SCENES[id]();
    cache.set(id, s);
  }
  return s;
}

/** An SVG as a data URI (base64 would be 33% bigger; percent-encoding only what must be). */
export function svgDataUri(svgText: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svgText).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'")}`;
}

const isBuiltin = (id: string): id is BuiltinWallpaper => Object.prototype.hasOwnProperty.call(SCENES, id);

/** The picture URL for a wallpaper id: a built-in scene as a data URI, a user file from the wallpapers route, or null for anything else. */
export function wallpaperUrl(id: string | undefined): string | null {
  if (!id) return null;
  if (isBuiltin(id)) return svgDataUri(wallpaperSvg(id));
  if (id.startsWith('user:')) return `/api/wallpapers/${encodeURIComponent(id.slice(5))}`;
  return null;
}
