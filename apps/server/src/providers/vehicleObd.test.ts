import { afterEach, describe, expect, it } from 'vitest';
import { startElmEmulator, type EmuValues, type EmulatorOptions } from '../obd/testing/elmEmulator';
import { TcpTransport } from '../obd/transport';
import { createObdVehicle } from './vehicleObd';
import type { VehicleProvider } from './vehicle';

const base = (): EmuValues => ({ rpm: 1726, speedKmh: 88, coolantC: 83, intakeC: 30, throttlePct: 20, loadPct: 45, fuelPct: 60, batteryV: 14.4, ambientC: 21 });

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function setup(emu: Partial<EmulatorOptions> = {}, car: EmuValues = base()) {
  const e = await startElmEmulator({ values: () => car, latencyMs: 2, ...emu });
  const p = createObdVehicle({ createTransport: () => new TcpTransport('127.0.0.1', e.port), retryDelaysMs: [40], ecuRetryMs: 40, cmdTimeoutMs: 800 });
  cleanup.push(() => e.close(), () => p.stop());
  return { e, p, car };
}

async function waitFor(pred: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for: ${what}`);
}
const live = (p: VehicleProvider) => p.state.get().connected && p.state.get().link?.status === 'live';

describe('OBD vehicle provider', () => {
  it('connects, reports the adapter and protocol, and decodes live readings', async () => {
    const { p } = await setup();
    expect(p.state.get()).toMatchObject({ source: 'obd', connected: false });
    p.start();
    await waitFor(() => live(p) && p.state.get().coolantC === 83 && p.state.get().batteryV > 14, 'live data');
    const s = p.state.get();
    expect(s.link).toMatchObject({ status: 'live', protocol: 'ISO 15765-4 (CAN 11/500)' });
    expect(s.link?.adapter).toMatch(/ELM327/);
    expect(s).toMatchObject({ rpm: 1726, speedKmh: 88, coolantC: 83, intakeC: 30, ambientC: 21, fuelPct: 60 });
    expect(s.throttlePct).toBeCloseTo(20, 0);
    expect(s.loadPct).toBeCloseTo(45, 0);
    expect(s.batteryV).toBeCloseTo(14.4, 1);
    expect(s.unsupported).toEqual([]);
  });

  it('follows the car as values change', async () => {
    const { p, car } = await setup();
    p.start();
    await waitFor(() => live(p) && p.state.get().rpm === 1726, 'initial rpm');
    car.rpm = 3000;
    car.speedKmh = 120;
    await waitFor(() => p.state.get().rpm === 3000 && p.state.get().speedKmh === 120, 'updated values');
  });

  it('integrates trip distance, time and averages from speed', async () => {
    const { p } = await setup();
    p.start();
    await waitFor(() => live(p) && p.state.get().trip.distanceKm > 0.03, '~1.3 s of driving at 88 km/h', 6000);
    const t = p.state.get().trip;
    expect(t.durationS).toBeGreaterThanOrEqual(1);
    expect(t.maxSpeedKmh).toBe(88);
    expect(t.avgSpeedKmh).toBeGreaterThan(80);
    expect(t.avgSpeedKmh).toBeLessThan(96);
    // distance ≈ speed × time (88 km/h = 24.4 m/s), within rounding of the displayed seconds.
    expect(t.distanceKm).toBeGreaterThan(0.03);
    expect(t.distanceKm).toBeLessThan(0.12);
  });

  it('lists readings the car lacks as unsupported instead of inventing them', async () => {
    const { p } = await setup({ supported: [0x0c, 0x0d, 0x05] });
    p.start();
    await waitFor(() => live(p) && (p.state.get().unsupported?.length ?? 0) >= 5, 'unsupported list');
    const s = p.state.get();
    expect(s.unsupported).toEqual(expect.arrayContaining(['fuelPct', 'ambientC', 'throttlePct', 'loadPct', 'intakeC']));
    expect(s.unsupported).not.toContain('rpm');
    expect(s.unsupported).not.toContain('coolantC');
    // Battery voltage falls back to the adapter's own measurement when the car has no PID 0x42.
    await waitFor(() => p.state.get().batteryV > 14, 'adapter voltage fallback');
    expect(p.state.get().unsupported).not.toContain('batteryV');
  });

  it('says so when the car is off, and goes live when it wakes', async () => {
    let on = false;
    const { p } = await setup({ ecuOn: () => on });
    p.start();
    await waitFor(() => p.state.get().link?.status === 'ecu-off', 'ecu-off');
    expect(p.state.get().connected).toBe(false);
    expect(p.state.get().link?.detail).toMatch(/ignition/i);
    expect(p.state.get().link?.adapter).toMatch(/ELM327/);
    on = true;
    await waitFor(() => live(p), 'live after wake');
  });

  it('notices ignition-off mid-drive and recovers, keeping the trip', async () => {
    let on = true;
    const { p } = await setup({ ecuOn: () => on });
    p.start();
    await waitFor(() => live(p) && p.state.get().trip.distanceKm > 0.01, 'driving');
    const before = p.state.get().trip.distanceKm;
    on = false;
    await waitFor(() => p.state.get().link?.status === 'ecu-off', 'ecu-off after ignition off', 6000);
    expect(p.state.get().connected).toBe(false);
    on = true;
    await waitFor(() => live(p), 'live again');
    expect(p.state.get().trip.distanceKm).toBeGreaterThanOrEqual(before);
  });

  it('reconnects by itself when the adapter link drops', async () => {
    const { p, e } = await setup();
    p.start();
    await waitFor(() => live(p), 'live');
    e.dropClients();
    await waitFor(() => p.state.get().link?.status === 'error' || !p.state.get().connected, 'drop noticed');
    expect(p.state.get().connected).toBe(false);
    await waitFor(() => live(p), 'reconnected', 8000);
  });

  it('shows a clear error when the adapter cannot be opened, then keeps retrying', async () => {
    const p = createObdVehicle({ createTransport: () => new TcpTransport('127.0.0.1', 1), retryDelaysMs: [30] });
    cleanup.push(() => p.stop());
    p.start();
    await waitFor(() => p.state.get().link?.status === 'error', 'error status');
    expect(p.state.get().link?.detail).toMatch(/retrying/);
    expect(p.state.get().connected).toBe(false);
  });

  it('stop() closes the adapter link and ends all activity', async () => {
    const { p, e } = await setup();
    p.start();
    await waitFor(() => live(p), 'live');
    p.stop();
    await new Promise((r) => setTimeout(r, 150));
    const n = e.log.length;
    await new Promise((r) => setTimeout(r, 250));
    expect(e.log.length).toBe(n); // no more commands after stop
  });

  describe('fault codes', () => {
    it('reads stored and pending codes with descriptions, and the check-engine lamp', async () => {
      const { p } = await setup({ stored: ['P0420', 'P1171'], pending: ['P0300'] });
      p.start();
      await waitFor(() => live(p) && p.state.get().mil?.on === true, 'mil');
      expect(p.state.get().mil).toEqual({ on: true, count: 2 });
      await p.readDtcs();
      const d = p.diagnostics.get();
      expect(d.status).toBe('idle');
      expect(d.readAt).toBeGreaterThan(0);
      expect(d.codes).toEqual([
        { code: 'P0420', kind: 'stored', description: expect.stringMatching(/Catalyst/) },
        { code: 'P1171', kind: 'stored' }, // manufacturer-specific → no invented description
        { code: 'P0300', kind: 'pending', description: expect.stringMatching(/misfire/i) },
      ]);
    });

    it('reassembles a multi-frame reply (5 codes)', async () => {
      const codes = ['P0100', 'P0200', 'P0300', 'P0400', 'P0500'];
      const { p } = await setup({ stored: [...codes] });
      p.start();
      await waitFor(() => live(p), 'live');
      await p.readDtcs();
      expect(p.diagnostics.get().codes.map((c) => c.code)).toEqual(codes);
    });

    it('decodes older (non-CAN) protocols too', async () => {
      const { p } = await setup({ protocol: 'iso', stored: ['P0133', 'P0420', 'P0300', 'P0171'] });
      p.start();
      await waitFor(() => live(p), 'live');
      expect(p.state.get().link?.protocol).toMatch(/9141/);
      await p.readDtcs();
      expect(p.diagnostics.get().codes.map((c) => c.code)).toEqual(['P0133', 'P0420', 'P0300', 'P0171']);
    });

    it('clears codes and the lamp', async () => {
      const { p } = await setup({ stored: ['P0420'] }, { ...base(), rpm: 0, speedKmh: 0 });
      p.start();
      await waitFor(() => live(p) && p.state.get().mil?.on === true, 'mil on');
      await p.clearDtcs();
      expect(p.diagnostics.get()).toMatchObject({ status: 'idle', codes: [] });
      await waitFor(() => p.state.get().mil?.on === false, 'mil off');
    });

    it('explains a refusal to clear while the engine is running', async () => {
      const { p } = await setup({ stored: ['P0420'], refuseClearWhenRunning: true });
      p.start();
      await waitFor(() => live(p), 'live');
      await p.clearDtcs();
      expect(p.diagnostics.get().status).toBe('error');
      expect(p.diagnostics.get().error).toMatch(/engine off/);
      await p.readDtcs();
      expect(p.diagnostics.get().codes.map((c) => c.code)).toEqual(['P0420']); // still there
    });

    it('refuses to read when the car is not connected', async () => {
      const { p } = await setup({ ecuOn: () => false });
      p.start();
      await waitFor(() => p.state.get().link?.status === 'ecu-off', 'ecu-off');
      await p.readDtcs();
      expect(p.diagnostics.get()).toMatchObject({ status: 'error', error: expect.stringMatching(/isn.t connected/) });
    });
  });
});
