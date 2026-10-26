import type { DiagnosticsState, Dtc, VehicleState } from '@headunit/shared';
import { DTC_DESCRIPTIONS } from '../obd/pids';
import { Observable } from '../observable';
import type { VehicleProvider } from '../providers/vehicle';

/** Drive cycle: [target km/h, seconds]. Loops forever. */
const CYCLE: Array<[number, number]> = [
  [0, 4],
  [45, 14],
  [50, 8],
  [0, 5],
  [70, 14],
  [100, 14],
  [120, 18],
  [90, 8],
  [50, 10],
  [0, 6],
];

// km/h → rpm multipliers per gear (index = gear). Roughly a 6-speed hatchback.
const GEAR_K = [0, 118, 68, 47, 35, 27, 22];
const GEAR_UP = [0, 14, 28, 46, 68, 92];
const IDLE_RPM = 800;

const gearFor = (kmh: number): number => {
  let g = 1;
  while (g < 6 && kmh >= (GEAR_UP[g] ?? Infinity)) g++;
  return g;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface VehicleSim extends VehicleProvider {
  /** Advance the model by dt seconds (exposed for tests). */
  step(dt: number): void;
}

export interface SimOptions {
  /** Start with a stored and a pending fault code, so the Diagnostics UI has something to show. */
  faults?: boolean;
}

export function createVehicleSim(rng: () => number = Math.random, opts: SimOptions = {}): VehicleSim {
  const link = { status: 'live', adapter: 'Simulator' } as const;
  let codes: Dtc[] = opts.faults
    ? [
        { code: 'P0420', kind: 'stored', description: DTC_DESCRIPTIONS.P0420 },
        { code: 'P0171', kind: 'pending', description: DTC_DESCRIPTIONS.P0171 },
      ]
    : [];
  const diagnostics = new Observable<DiagnosticsState>({ status: 'idle', codes: [], readAt: null });
  const milState = () => ({ on: codes.some((c) => c.kind === 'stored'), count: codes.filter((c) => c.kind === 'stored').length });

  const state = new Observable<VehicleState>({
    source: 'sim',
    link,
    mil: milState(),
    connected: true,
    speedKmh: 0,
    rpm: IDLE_RPM,
    coolantC: 62,
    intakeC: 28,
    ambientC: 21.5,
    throttlePct: 0,
    loadPct: 18,
    fuelPct: 72,
    batteryV: 14.1,
    trip: { distanceKm: 0, durationS: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 },
  });

  let phase = 0;
  let phaseT = 0;
  let speed = 0;
  let rpm = IDLE_RPM;
  let coolant = 62;
  let fuel = 72;
  let distance = 0;
  let duration = 0;
  let maxSpeed = 0;
  let timer: NodeJS.Timeout | null = null;

  function step(dt: number) {
    phaseT += dt;
    let [target, len] = CYCLE[phase]!;
    if (phaseT >= len) {
      phase = (phase + 1) % CYCLE.length;
      phaseT = 0;
      [target, len] = CYCLE[phase]!;
    }

    const prev = speed;
    const maxUp = 9; // km/h per second
    const maxDown = 14;
    const delta = clamp(target - speed, -maxDown * dt, maxUp * dt);
    speed = Math.max(0, speed + delta + (speed > 1 ? (rng() - 0.5) * 0.2 : 0));
    const accel = (speed - prev) / dt; // km/h/s

    const gear = gearFor(speed);
    const targetRpm = speed < 1 ? IDLE_RPM : Math.max(IDLE_RPM, speed * (GEAR_K[gear] ?? 22));
    rpm += (targetRpm - rpm) * Math.min(1, dt * 7);
    rpm = clamp(rpm + (rng() - 0.5) * 12, 650, 6800);

    const throttle = speed < 1 ? 0 : clamp(12 + accel * 7 + speed * 0.12, 0, 100);
    const load = clamp(18 + throttle * 0.7 + (rpm - IDLE_RPM) * 0.004, 0, 100);

    coolant = Math.min(90 + Math.sin(duration / 25) * 1.2, coolant + dt * 0.45);
    fuel = Math.max(0, fuel - dt * (0.004 + load * 0.00008));

    distance += (speed / 3600) * dt;
    duration += dt;
    maxSpeed = Math.max(maxSpeed, speed);

    state.set({
      source: 'sim',
      connected: true,
      link,
      mil: milState(),
      speedKmh: Math.round(speed * 10) / 10,
      rpm: Math.round(rpm),
      coolantC: Math.round(coolant * 10) / 10,
      intakeC: Math.round((26 + load * 0.12) * 10) / 10,
      ambientC: 21.5,
      throttlePct: Math.round(throttle),
      loadPct: Math.round(load),
      fuelPct: Math.round(fuel * 10) / 10,
      batteryV: rpm > 700 ? Math.round((14.1 + (rng() - 0.5) * 0.1) * 10) / 10 : 12.6,
      trip: {
        distanceKm: Math.round(distance * 100) / 100,
        durationS: Math.round(duration),
        avgSpeedKmh: duration > 0 ? Math.round((distance / duration) * 3600 * 10) / 10 : 0,
        maxSpeedKmh: Math.round(maxSpeed),
      },
    });
  }

  /** A short fake delay so the UI's "reading…" state can be seen. */
  const later = (fn: () => void) => {
    const t = setTimeout(fn, 400);
    t.unref();
  };

  return {
    state,
    diagnostics,
    step,
    async readDtcs() {
      diagnostics.update({ status: 'reading', error: undefined });
      later(() => diagnostics.set({ status: 'idle', codes: [...codes], readAt: Date.now() }));
    },
    async clearDtcs() {
      diagnostics.update({ status: 'clearing', error: undefined });
      later(() => {
        codes = [];
        diagnostics.set({ status: 'idle', codes: [], readAt: Date.now() });
      });
    },
    start() {
      if (timer) return;
      const interval = 100;
      timer = setInterval(() => step(interval / 1000), interval);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
