import { describe, expect, it } from 'vitest';
import { FADE_S, SOUNDS, crackles, noise, normalise, seamless, seeded, sleepGain } from './sounds';

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
/** Mean absolute step between neighbours: high for hiss, low for rumble. */
const roughness = (a: Float32Array) => {
  let s = 0;
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i]! - a[i - 1]!);
  return s / (a.length - 1);
};

describe('noise', () => {
  it('is reproducible from a seed', () => {
    expect(noise('pink', 500, seeded(4))).toEqual(noise('pink', 500, seeded(4)));
    expect(noise('pink', 500, seeded(4))).not.toEqual(noise('pink', 500, seeded(5)));
  });

  it('stays inside -0.9..0.9 for every colour', () => {
    for (const c of ['white', 'pink', 'brown'] as const) {
      const a = noise(c, 20000, seeded(1));
      expect(Math.max(...a.map(Math.abs))).toBeCloseTo(0.9, 5);
      expect(rms(a)).toBeGreaterThan(0.05);
    }
  });

  it('gets smoother from white to pink to brown', () => {
    const w = roughness(noise('white', 20000, seeded(2)));
    const p = roughness(noise('pink', 20000, seeded(2)));
    const b = roughness(noise('brown', 20000, seeded(2)));
    expect(w).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(b);
  });
});

describe('crackles', () => {
  it('is mostly silence with a few clicks', () => {
    const a = crackles(48000, 48000, 8, seeded(3));
    const loud = a.filter((v) => Math.abs(v) > 0.05).length;
    expect(loud).toBeGreaterThan(0);
    expect(loud / a.length).toBeLessThan(0.2);
  });
});

describe('seamless', () => {
  it('blends the loop seam so the end leads into the start', () => {
    const a = new Float32Array(1000).map((_, i) => i / 1000);
    const s = seamless(a, 100);
    expect(s.length).toBe(900);
    expect(s[0]).toBeCloseTo(a[900]!, 5);
    expect(s[99]).toBeCloseTo(a[99]!, 1);
  });
  it('normalise leaves silence alone', () => {
    expect(Array.from(normalise(new Float32Array(4), 1))).toEqual([0, 0, 0, 0]);
  });
});

describe('sleepGain', () => {
  it('holds full level, then fades over the last seconds', () => {
    expect(sleepGain(null)).toBe(1);
    expect(sleepGain(FADE_S * 3)).toBe(1);
    expect(sleepGain(FADE_S / 2)).toBeCloseTo(0.5);
    expect(sleepGain(0)).toBe(0);
    expect(sleepGain(-5)).toBe(0);
  });
});

it('every sound has a distinct id and a label', () => {
  expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length);
  for (const s of SOUNDS) expect(s.label.length).toBeGreaterThan(2);
});
