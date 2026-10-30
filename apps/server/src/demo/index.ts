import { createMockMedia } from './mediaMock';
import { createMockProjection } from './projection';
import { createSimDevices } from './devicesSim';
import { createSimSystem } from './system';
import { createVehicleSim } from './vehicleSim';

/**
 * Demo mode: a car, phones, sound outputs, an Android Auto session and a music library that are all simulated, so the interface can
 * be designed, tested and shown on a laptop with no Pi, no car and no accounts.
 *
 * It is switched on ONLY by the `--demo` command-line flag (`npm run dev` passes it, `npm start` and the systemd unit never do), never by
 * a setting or an environment variable that an old `.env` could carry onto a real head unit. The UI labels everything while it is on.
 */
export const isDemoMode = (argv: readonly string[] = process.argv): boolean => argv.includes('--demo');

export function createDemoWorld() {
  return {
    vehicle: createVehicleSim(Math.random, { faults: true }),
    devices: createSimDevices(),
    system: createSimSystem(),
    projection: createMockProjection(),
    mock: createMockMedia(),
  };
}

export { createDemoFetch } from './net';
export { runGpsSim } from './gpsSim';
export { seedDemoData } from './seed';
