import type { VehicleState } from '@headunit/shared';
import type { Observable } from '../observable';

/** A closed loop of [lat, lon] corners (a few km round, near Greenwich: a neutral, real place). The simulated car drives it forever. */
export const DEMO_ROUTE: Array<[number, number]> = [
  [51.4779, 0.0015],
  [51.4812, 0.0102],
  [51.4871, 0.0168],
  [51.4925, 0.0121],
  [51.4944, 0.0032],
  [51.4912, -0.0063],
  [51.4851, -0.0101],
  [51.4795, -0.0058],
];

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: [number, number], b: [number, number]): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export interface GpsSim {
  /** Advance the car by `meters` along the route and return a gpsd-style TPV message for the new position. */
  advance(meters: number, speedKmh: number): Record<string, unknown>;
}

export function createGpsSim(route = DEMO_ROUTE): GpsSim {
  let leg = 0;
  let along = 0;
  const len = (i: number) => distanceM(route[i]!, route[(i + 1) % route.length]!);

  return {
    advance(meters, speedKmh) {
      along += meters;
      while (along >= len(leg)) {
        along -= len(leg);
        leg = (leg + 1) % route.length;
      }
      const a = route[leg]!;
      const b = route[(leg + 1) % route.length]!;
      const t = along / len(leg);
      return {
        class: 'TPV',
        mode: 3,
        lat: a[0] + (b[0] - a[0]) * t,
        lon: a[1] + (b[1] - a[1]) * t,
        speed: speedKmh / 3.6,
        track: bearingDeg(a, b),
        altMSL: 42,
        eph: 4.5,
      };
    },
  };
}

/**
 * Every second, move the simulated GPS by what the simulated car just travelled and hand gpsd-style messages to `ingest`
 * (the same entry point real gpsd data takes, so the whole GPS pipeline is exercised). Returns a stop function.
 */
export function runGpsSim(vehicle: Observable<VehicleState>, ingest: (msg: Record<string, unknown>) => void, sim = createGpsSim()): () => void {
  ingest({ class: 'SKY', satellites: Array.from({ length: 14 }, (_, i) => ({ used: i < 10 })) });
  const timer = setInterval(() => {
    const v = vehicle.get().speedKmh;
    ingest(sim.advance(v / 3.6, v));
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
