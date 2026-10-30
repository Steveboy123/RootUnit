import { describe, expect, it } from 'vitest';
import { projectTrack, startsNewSegment, scaleBar } from './trackMap';

describe('projectTrack', () => {
  it('puts north up and east right', () => {
    const p = projectTrack([{ lat: 51.5, lon: 0 }, { lat: 51.51, lon: 0.02 }], 200, 200);
    const a = p.project({ lat: 51.5, lon: 0 });
    const b = p.project({ lat: 51.51, lon: 0.02 });
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y); // further north is higher on screen (smaller y)
  });

  it('keeps the shape true: a square on the ground is a square on the screen, at any latitude', () => {
    for (const lat of [0, 51.5, 70]) {
      const dLat = 0.01;
      const dLon = dLat / Math.cos(((lat + dLat / 2) * Math.PI) / 180); // the same distance east as north, measured at the middle of the box
      const p = projectTrack([{ lat, lon: 0 }, { lat: lat + dLat, lon: dLon }], 300, 300, 10);
      const a = p.project({ lat, lon: 0 });
      const b = p.project({ lat: lat + dLat, lon: dLon });
      expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(b.y - a.y), 3);
    }
  });

  it('fits everything inside the box with the padding', () => {
    const pts = [{ lat: 51.4, lon: -0.2 }, { lat: 51.6, lon: 0.3 }, { lat: 51.5, lon: 0.1 }];
    const p = projectTrack(pts, 400, 250, 20);
    for (const pt of pts) {
      const q = p.project(pt);
      expect(q.x).toBeGreaterThanOrEqual(19.999);
      expect(q.x).toBeLessThanOrEqual(380.001);
      expect(q.y).toBeGreaterThanOrEqual(19.999);
      expect(q.y).toBeLessThanOrEqual(230.001);
    }
  });

  it('includes extra points (the car, the parking pin) in the fit without drawing them in the path', () => {
    const track = [{ lat: 51.5, lon: 0 }, { lat: 51.5, lon: 0.01 }];
    const withPin = projectTrack(track, 300, 200, 10, [{ lat: 51.52, lon: 0.005 }]);
    const q = withPin.project({ lat: 51.52, lon: 0.005 });
    expect(q.y).toBeGreaterThanOrEqual(9.999);
    expect(withPin.path.match(/[ML]/g)).toHaveLength(2);
  });

  it('builds an SVG path through the points', () => {
    const p = projectTrack([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0.01, lon: 0.01 }], 100, 100);
    expect(p.path).toMatch(/^M[\d.-]+,[\d.-]+L[\d.-]+,[\d.-]+L[\d.-]+,[\d.-]+$/);
  });

  it('puts a single point in the middle, and does not zoom in without limit on a tiny track', () => {
    const one = projectTrack([{ lat: 51.5, lon: 0.1 }], 200, 100);
    expect(one.project({ lat: 51.5, lon: 0.1 })).toEqual({ x: 100, y: 50 });
    const tiny = projectTrack([{ lat: 51.5, lon: 0 }, { lat: 51.50001, lon: 0.00001 }], 200, 200, 10);
    expect(tiny.metresPerPx).toBeGreaterThan(0.1); // a 1 m track is not blown up to fill the box
  });

  it('has nothing to draw with no points or no box, and never returns NaN', () => {
    expect(projectTrack([], 100, 100).path).toBe('');
    expect(projectTrack([], 100, 100).project({ lat: 1, lon: 1 })).toEqual({ x: 50, y: 50 });
    const zero = projectTrack([{ lat: 1, lon: 1 }], 0, 0);
    expect(Number.isNaN(zero.project({ lat: 1, lon: 1 }).x)).toBe(false);
    const same = projectTrack([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }], 100, 100);
    expect(Number.isFinite(same.metresPerPx)).toBe(true);
  });
});

describe('scaleBar', () => {
  it('chooses a round length close to the target size', () => {
    const bar = scaleBar(2.1, 90)!; // 189 m across 90 px
    expect(bar.metres).toBe(100);
    expect(bar.px).toBeCloseTo(100 / 2.1, 5);
    expect(scaleBar(0.4, 90)!.metres).toBe(20); // 36 m raw
    expect(scaleBar(20, 90)!.metres).toBe(1000); // 1800 m raw
  });
  it('is nothing for no scale', () => {
    expect(scaleBar(0)).toBeNull();
    expect(scaleBar(Number.NaN)).toBeNull();
  });
});

describe('startsNewSegment', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 5, 1, 12, 0, s)).toISOString();
  const here = { lat: 51.5, lon: 0 };
  it('keeps ordinary driving as one line', () => {
    // about 55 m in 5 s is 40 km/h
    expect(startsNewSegment({ ...here, at: at(0) }, { lat: 51.5005, lon: 0, at: at(5) })).toBe(false);
  });
  it('lifts the pen after a long gap, even to the same place', () => {
    expect(startsNewSegment({ ...here, at: at(0) }, { ...here, at: at(16 * 60) })).toBe(true);
    expect(startsNewSegment({ ...here, at: at(0) }, { ...here, at: at(14 * 60) })).toBe(false);
  });
  it('lifts the pen for a teleport: a kilometre in five seconds', () => {
    expect(startsNewSegment({ ...here, at: at(0) }, { lat: 51.509, lon: 0, at: at(5) })).toBe(true);
  });
  it('does not mistake GPS jitter for a jump', () => {
    // 20 m in one second is 72 km/h; and a 10 m wobble in 0.0 s is below the distance floor
    expect(startsNewSegment({ ...here, at: at(0) }, { lat: 51.50018, lon: 0, at: at(1) })).toBe(false);
    expect(startsNewSegment({ ...here, at: at(0) }, { lat: 51.50009, lon: 0, at: at(0) })).toBe(false);
  });
  it('never breaks a line that has no times', () => {
    expect(startsNewSegment(here, { lat: 52, lon: 1 })).toBe(false);
    expect(startsNewSegment({ ...here, at: 'nonsense' }, { lat: 52, lon: 1, at: at(1) })).toBe(false);
  });
  it('treats a clock that went backwards as a break only for a big move', () => {
    expect(startsNewSegment({ ...here, at: at(10) }, { lat: 51.5001, lon: 0, at: at(5) })).toBe(false);
    expect(startsNewSegment({ ...here, at: at(10) }, { lat: 51.52, lon: 0, at: at(5) })).toBe(true);
  });
});

describe('projectTrack with a gap', () => {
  it('draws the two halves as separate strokes', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 5, 1, 12, 0, s)).toISOString();
    const pts = [
      { lat: 51.5, lon: 0, at: at(0) },
      { lat: 51.5005, lon: 0, at: at(5) },
      { lat: 51.52, lon: 0.02, at: at(3600) },
      { lat: 51.5205, lon: 0.02, at: at(3605) },
    ];
    const { path } = projectTrack(pts, 400, 300);
    expect((path.match(/M/g) ?? []).length).toBe(2);
    expect((path.match(/L/g) ?? []).length).toBe(2);
  });
});
