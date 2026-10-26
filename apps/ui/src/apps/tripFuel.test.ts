import { describe, expect, it } from 'vitest';
import { tripFuel } from './tripFuel';

describe('tripFuel', () => {
  it('works out litres and litres per 100 km from the gauge drop and the tank size', () => {
    // 4 % of a 50 L tank is 2 L over 30 km: 6.7 L/100 km
    expect(tripFuel({ distanceKm: 30, fuelUsedPct: 4 }, 50)).toEqual({ liters: 2, lPer100: 6.7 });
  });
  it('needs the tank size and a real drop', () => {
    expect(tripFuel({ distanceKm: 30, fuelUsedPct: 4 }, null)).toBeNull();
    expect(tripFuel({ distanceKm: 30 }, 50)).toBeNull();
    expect(tripFuel({ distanceKm: 30, fuelUsedPct: 0 }, 50)).toBeNull();
    expect(tripFuel({ distanceKm: 30, fuelUsedPct: -2 }, 50)).toBeNull();
  });
  it('says nothing for a short trip or a drop under a percent: the gauge is too coarse to mean anything', () => {
    expect(tripFuel({ distanceKm: 4, fuelUsedPct: 3 }, 50)).toBeNull();
    expect(tripFuel({ distanceKm: 60, fuelUsedPct: 0.5 }, 50)).toBeNull();
  });
  it('rejects a result no car could produce (a refill mid-trip, a stuck gauge)', () => {
    expect(tripFuel({ distanceKm: 100, fuelUsedPct: 1 }, 50)).toBeNull(); // 0.5 L per 100 km
    expect(tripFuel({ distanceKm: 10, fuelUsedPct: 90 }, 50)).toBeNull(); // 450 L per 100 km
  });
});
