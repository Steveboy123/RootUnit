import { describe, expect, it } from 'vitest';
import { dominantColor, ensureReadable } from './accent';

const fill = (rgb: [number, number, number], n: number, a = 255) => Array.from({ length: n }, () => [...rgb, a]).flat();
const px = (...parts: number[][]) => Uint8ClampedArray.from(parts.flat());
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hex(h) as [number, number, number];
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

describe('dominantColor', () => {
  it('picks the vivid colour, not the larger grey area', () => {
    const c = dominantColor(px(fill([120, 120, 120], 800), fill([230, 40, 60], 200)))!;
    const [r, g, b] = hex(c) as [number, number, number];
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(90);
    expect(b).toBeLessThan(110);
  });
  it('picks the biggest saturated hue', () => {
    const blue = dominantColor(px(fill([40, 90, 230], 600), fill([230, 40, 60], 100)))!;
    expect(hex(blue)[2]).toBeGreaterThan(200);
    const red = dominantColor(px(fill([40, 90, 230], 100), fill([230, 40, 60], 600)))!;
    expect(hex(red)[0]).toBeGreaterThan(200);
  });
  it('returns null for a picture with no colour (greys, black, white, transparent)', () => {
    expect(dominantColor(px(fill([128, 128, 128], 100)))).toBeNull();
    expect(dominantColor(px(fill([0, 0, 0], 100)))).toBeNull();
    expect(dominantColor(px(fill([255, 255, 255], 100)))).toBeNull();
    expect(dominantColor(px(fill([230, 40, 60], 100, 0)))).toBeNull();
    expect(dominantColor(new Uint8ClampedArray(0))).toBeNull();
  });
  it('ignores a few stray pixels of another colour', () => {
    const c = dominantColor(px(fill([30, 200, 90], 500), fill([230, 40, 60], 5)))!;
    expect(hex(c)[1]).toBeGreaterThan(150);
  });
  it('always returns a valid #rrggbb', () => {
    expect(dominantColor(px(fill([10, 20, 200], 50)))).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ensureReadable', () => {
  it('lifts very dark colours until they are legible on a dark UI', () => {
    expect(lum(ensureReadable([10, 10, 90]))).toBeGreaterThanOrEqual(0.17);
  });
  it('leaves already-bright colours alone', () => {
    expect(ensureReadable([255, 200, 0])).toBe('#ffc800');
  });
});
