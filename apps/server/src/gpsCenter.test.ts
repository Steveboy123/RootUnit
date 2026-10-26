import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GpsCenter, distanceKm } from './gpsCenter';
import { JsonStore } from './store';

let dir: string;
let store: JsonStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gps-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  await store.flush();
  await rm(dir, { recursive: true, force: true });
});

const tpv = (lat: number, lon: number, extra: Record<string, unknown> = {}) => ({ class: 'TPV', mode: 3, lat, lon, speed: 10, track: 90, altMSL: 40, eph: 5, ...extra });

describe('distanceKm', () => {
  it('knows a degree of latitude is about 111 km', () => {
    expect(distanceKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
    expect(distanceKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });
});

describe('GpsCenter.ingest', () => {
  let t: number;
  const make = () => new GpsCenter(store, () => t);
  beforeEach(() => void (t = 1_700_000_000_000));
  /** Started, with the clock moved past the publish window, so the next update goes out immediately. */
  const started = async () => {
    const g = make();
    await g.start(false);
    t += 1000;
    return g;
  };

  it('turns a position message into speed, heading, altitude and accuracy', async () => {
    const g = await started();
    g.ingest(tpv(51.5, -0.1, { speed: 13.89 }));
    expect(g.state.get()).toMatchObject({ connected: true, fix: true, latitude: 51.5, longitude: -0.1, heading: 90, altitudeM: 40, accuracyM: 5, detail: 'Live satellite position' });
    expect(g.state.get().speedKmh).toBeCloseTo(50, 0);
    g.stop();
  });

  it('counts satellites from a SKY message', async () => {
    const g = await started();
    g.ingest({ class: 'SKY', satellites: [{ used: true }, { used: true }, { used: false }] });
    expect(g.state.get()).toMatchObject({ satellites: 3, usedSatellites: 2 });
    g.stop();
  });

  it('ignores a message with no fix, no position, or an impossible one', async () => {
    const g = make();
    await g.start(false);
    g.ingest({ class: 'TPV', mode: 1 });
    g.ingest({ class: 'TPV', mode: 3, lat: 'north' });
    g.ingest(tpv(95, 0));
    g.ingest(tpv(0, 200));
    g.ingest({ class: 'VERSION' });
    expect(g.state.get().fix).toBe(false);
    g.stop();
  });

  it('adds up trip distance between good readings and ignores a jump no car could make', async () => {
    const g = make();
    await g.start(false);
    g.ingest(tpv(51.5, 0));
    t += 1000;
    g.ingest(tpv(51.5001, 0)); // about 11 m in a second
    const after = g.state.get().tripKm;
    expect(after).toBeGreaterThan(0.009);
    expect(after).toBeLessThan(0.013);
    t += 1000;
    g.ingest(tpv(52.5, 0)); // 111 km in a second: a glitch
    expect(g.state.get().tripKm).toBeCloseTo(after, 6);
    g.stop();
  });

  it('does not count readings that are too inaccurate to trust', async () => {
    const g = make();
    await g.start(false);
    g.ingest(tpv(51.5, 0));
    t += 1000;
    g.ingest(tpv(51.5001, 0, { eph: 80 }));
    expect(g.state.get().tripKm).toBe(0);
    g.stop();
  });

  it('tracks the top speed and caps nonsense at 300', async () => {
    const g = await started();
    g.ingest(tpv(51.5, 0, { speed: 20 }));
    g.ingest(tpv(51.5, 0, { speed: 5000 }));
    g.flush();
    expect(g.state.get().topSpeedKmh).toBe(300);
    g.stop();
  });

  it('says there is no fix any more when the readings stop (a tunnel, an unplugged receiver)', async () => {
    const g = await started();
    g.ingest(tpv(51.5, 0));
    expect(g.state.get().fix).toBe(true);
    t += 10_000;
    g['expire']();
    expect(g.state.get()).toMatchObject({ fix: false, speedKmh: null });
    g.stop();
  });

  it('publishes at most twice a second however fast the receiver talks', async () => {
    const g = make();
    await g.start(false);
    let n = 0;
    g.state.subscribe(() => n++);
    for (let i = 0; i < 20; i++) {
      g.ingest(tpv(51.5 + i * 1e-5, 0));
      t += 50; // 20 Hz
    }
    expect(n).toBeLessThanOrEqual(3);
    // ...but nothing is lost: once the window ends the latest position is delivered.
    await new Promise((r) => setTimeout(r, 600));
    expect(g.state.get().latitude).toBeCloseTo(51.50019, 5);
    g.stop();
  });

  it('saves the parking spot only with a fix, and forgets it on request', async () => {
    const g = make();
    await g.start(false);
    await expect(g.command('park')).rejects.toThrow('GPS fix');
    g.ingest(tpv(51.5, -0.2));
    const s = await g.command('park');
    expect(s.parked).toMatchObject({ latitude: 51.5, longitude: -0.2 });
    await store.flush();
    const again = make();
    await again.start(false);
    expect(again.state.get().parked).toMatchObject({ latitude: 51.5, longitude: -0.2 });
    expect((await again.command('clear-park')).parked).toBeNull();
    await expect(again.command('explode')).rejects.toThrow('Unknown');
    again.stop();
    g.stop();
  });

  it('resets the trip, and exports the route as GPX and CSV', async () => {
    const g = make();
    await g.start(false);
    g.ingest(tpv(51.5, 0));
    t += 6000;
    g.ingest(tpv(51.502, 0));
    expect(g.track()).toHaveLength(2);
    expect(g.gpx()).toContain('<trkpt lat="51.502" lon="0">');
    expect(g.gpx()).toContain('<ele>40</ele>');
    expect(g.csv().split('\n')).toHaveLength(3);
    await g.command('reset-trip');
    expect(g.state.get()).toMatchObject({ tripKm: 0, topSpeedKmh: 0 });
    expect(g.track()).toEqual([]);
    g.stop();
  });
});

describe('GpsCenter over a real socket', () => {
  /** A stand-in for gpsd: waits for ?WATCH and then streams a position, like the real daemon does. */
  async function fakeGpsd() {
    const received: string[] = [];
    const sockets = new Set<Socket>();
    const server: Server = createServer((sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
      sock.on('data', (d) => {
        received.push(d.toString());
        sock.write(JSON.stringify({ class: 'SKY', satellites: [{ used: true }, { used: true }, { used: false }] }) + '\n');
        sock.write(JSON.stringify({ class: 'TPV', mode: 3, lat: 51.5, lon: -0.12, speed: 8.33, track: 270, eph: 3 }) + '\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    return {
      port,
      received,
      close: () => {
        for (const s of sockets) s.destroy();
        server.close();
      },
    };
  }

  it('connects to gpsd, asks for JSON updates and shows what it hears (the v0.5.0 code never opened the connection)', async () => {
    const gpsd = await fakeGpsd();
    const g = new GpsCenter(store, Date.now, gpsd.port);
    await g.start(true);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no fix after 3 s')), 3000);
      g.state.subscribe((s) => {
        if (s.fix) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(gpsd.received.join('')).toContain('?WATCH={"enable":true,"json":true}');
    expect(g.state.get()).toMatchObject({ connected: true, fix: true, latitude: 51.5, longitude: -0.12, heading: 270, satellites: 3, usedSatellites: 2 });
    expect(g.state.get().speedKmh).toBeCloseTo(30, 0);
    g.stop();
    gpsd.close();
  });

  it('says gpsd is not reachable when nothing is listening, instead of pretending', async () => {
    const g = new GpsCenter(store, Date.now, 1); // nothing listens on port 1
    await g.start(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(g.state.get()).toMatchObject({ connected: false, fix: false, detail: 'gpsd not reachable. Check GPS setup/service.' });
    g.stop();
  });
});
