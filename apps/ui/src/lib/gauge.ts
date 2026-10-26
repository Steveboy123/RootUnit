/** Pure geometry for the arc gauge (SVG: 0° = +x axis, angles grow clockwise). */
export const SWEEP_START = 135;
export const SWEEP = 270;

export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** SVG arc path from startDeg sweeping clockwise to endDeg (≤ 360° sweep). */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function valueToDeg(value: number, min: number, max: number): number {
  const t = max === min ? 0 : (value - min) / (max - min);
  return SWEEP_START + Math.min(1, Math.max(0, t)) * SWEEP;
}

/** Evenly spaced "nice" tick values from min to max (inclusive) with the given step. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Pick a major-tick step giving roughly `target` ticks across the range. */
export function niceStep(min: number, max: number, target = 8): number {
  const raw = (max - min) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return nice * pow;
}
