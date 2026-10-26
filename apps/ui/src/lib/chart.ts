/** Geometry for the small SVG charts. Pure functions, so the awkward cases (all zeros, one point, a flat line) are tested. */

/** A tidy upper bound for an axis: 1, 2, 2.5, 5 or 10 times a power of ten that is at least `v`. */
export function niceMax(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** Compact tick labels: 0, 500, 1K, 2.5K. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round((n / 1000) * 10) / 10}K`;
  return String(Math.round(n * 10) / 10);
}

/**
 * A bar from the baseline up with only its top corners rounded (the specification: a 4 px rounded data end, square at the
 * baseline). The radius never exceeds half the width or the height, so a stub of a bar stays a valid shape.
 */
export function barPath(x: number, w: number, top: number, baseline: number, radius = 4): string {
  const h = baseline - top;
  const r = Math.max(0, Math.min(radius, w / 2, h));
  if (h <= 0 || w <= 0) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(x)},${f(baseline)}V${f(top + r)}Q${f(x)},${f(top)} ${f(x + r)},${f(top)}H${f(x + w - r)}Q${f(x + w)},${f(top)} ${f(x + w)},${f(top + r)}V${f(baseline)}Z`;
}

export interface Scale {
  /** Data value to a y coordinate (higher values are higher on the screen). */
  y(v: number): number;
  min: number;
  max: number;
}

/** A y scale mapping [min, max] onto [bottom, top]; a flat series gets a little headroom instead of a divide by zero. */
export function yScale(values: readonly number[], top: number, bottom: number, opts: { zero?: boolean; pad?: number } = {}): Scale {
  const vals = values.filter(Number.isFinite);
  let min = opts.zero ? 0 : Math.min(...vals);
  let max = Math.max(...vals);
  if (!vals.length) [min, max] = [0, 1];
  if (max === min) {
    max = min + 1;
    if (!opts.zero) min -= 1;
  }
  const pad = opts.zero ? 0 : (max - min) * (opts.pad ?? 0.15);
  const lo = min - pad;
  const hi = max + pad;
  return { y: (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top), min: lo, max: hi };
}

/** Evenly spaced x positions for `n` points between left and right (one point sits in the middle). */
export function xPositions(n: number, left: number, right: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(left + right) / 2];
  return Array.from({ length: n }, (_, i) => left + ((right - left) * i) / (n - 1));
}

/** "M x,y L x,y ..." for a polyline, skipping gaps (null values) by starting a new sub-path. */
export function linePath(xs: readonly number[], ys: ReadonlyArray<number | null>): string {
  let d = '';
  let pen = false;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (y === null || y === undefined || !Number.isFinite(y)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    pen = true;
  });
  return d;
}

/** The index of the point nearest to x (for tapping on a line chart). */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = 0;
  let dist = Infinity;
  xs.forEach((px, i) => {
    const d = Math.abs(px - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}
