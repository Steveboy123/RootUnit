import { describe, expect, it } from 'vitest';
import { createVehicleSim } from './vehicleSim';

describe('vehicle simulator', () => {
  it('produces plausible, bounded values across a full drive cycle', () => {
    const sim = createVehicleSim(() => 0.5);
    let maxSpeed = 0;
    let maxRpm = 0;
    for (let i = 0; i < 1300; i++) {
      sim.step(0.1);
      const s = sim.state.get();
      maxSpeed = Math.max(maxSpeed, s.speedKmh);
      maxRpm = Math.max(maxRpm, s.rpm);
      expect(s.rpm).toBeGreaterThanOrEqual(650);
      expect(s.rpm).toBeLessThanOrEqual(6800);
      expect(s.speedKmh).toBeGreaterThanOrEqual(0);
      expect(s.fuelPct).toBeGreaterThanOrEqual(0);
      expect(s.throttlePct).toBeLessThanOrEqual(100);
    }
    expect(maxSpeed).toBeGreaterThan(110);
    expect(maxRpm).toBeGreaterThan(2000);
    const { trip } = sim.state.get();
    expect(trip.distanceKm).toBeGreaterThan(1);
    expect(trip.maxSpeedKmh).toBeGreaterThan(110);
  });

  it('warms the engine up and idles when stopped', () => {
    const sim = createVehicleSim(() => 0.5);
    sim.step(0.1);
    expect(sim.state.get().speedKmh).toBe(0);
    expect(sim.state.get().rpm).toBeLessThan(900);
    for (let i = 0; i < 700; i++) sim.step(0.1);
    expect(sim.state.get().coolantC).toBeGreaterThan(80);
  });
});
