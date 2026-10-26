import { Socket } from 'node:net';
import type { GpsState, GpsTrackPoint } from '@headunit/shared';
import { Observable } from './observable';
import type { JsonStore } from './store';

export type { GpsState };

const FILE = 'gps-center.json';
const GPSD_PORT = 2947;
/** Without a new fix for this long the position is stale: the screens must not keep showing a speed. */
const STALE_MS = 6500;
/** Readings less accurate than this (metres) neither extend the trip nor move the "previous point". */
const MAX_ERROR_M = 35;
/** The route is a breadcrumb, not a recording: a point every few seconds, the last 2000. */
const ROUTE_MIN_MS = 5000;
const ROUTE_MIN_KM = 0.008;
const ROUTE_MAX = 2000;
/** Screens are told at most this often (a receiver at 10 Hz does not need 10 redraws a second). */
const PUBLISH_MS = 500;

const INITIAL: GpsState = {
  connected: false,
  fix: false,
  lastFix: null,
  latitude: null,
  longitude: null,
  speedKmh: null,
  heading: null,
  altitudeM: null,
  accuracyM: null,
  satellites: null,
  usedSatellites: null,
  tripKm: 0,
  topSpeedKmh: 0,
  tripStarted: null,
  parked: null,
  detail: 'Connecting to gpsd on localhost:2947',
};

const finite = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Great-circle distance in km between two latitude/longitude pairs (degrees). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface RoutePoint extends GpsTrackPoint {
  alt: number | null;
}

const validRoutePoint = (v: unknown): v is RoutePoint => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && typeof p.at === 'string';
};

/** Position, speed and heading from the local gpsd daemon (USB GPS receiver). No network and no maps API. */
export class GpsCenter {
  readonly state = new Observable<GpsState>({ ...INITIAL });
  private cur: GpsState = { ...INITIAL };
  private socket?: Socket;
  private retry?: ReturnType<typeof setTimeout>;
  private staleTimer?: ReturnType<typeof setInterval>;
  private saveTimer?: ReturnType<typeof setInterval>;
  private closed = false;
  private buffer = '';
  private previous: { lat: number; lon: number; time: number } | null = null;
  private route: RoutePoint[] = [];
  private lastPublish = 0;
  private trailing?: ReturnType<typeof setTimeout>;

  constructor(
    private store: JsonStore,
    private now: () => number = Date.now,
    private gpsdPort = GPSD_PORT,
  ) {}

  /** `connect: false` skips the gpsd socket (demo mode feeds `ingest` directly). */
  async start(connect = true): Promise<void> {
    const saved = (await this.store.read(FILE)) as (Partial<GpsState> & { route?: unknown[] }) | null;
    if (saved) {
      const p = saved.parked;
      this.cur.parked = p && typeof p.latitude === 'number' && typeof p.longitude === 'number' && typeof p.at === 'string' ? { latitude: p.latitude, longitude: p.longitude, at: p.at } : null;
      this.cur.tripKm = finite(saved.tripKm) ?? 0;
      this.cur.topSpeedKmh = finite(saved.topSpeedKmh) ?? 0;
      this.cur.tripStarted = typeof saved.tripStarted === 'string' ? saved.tripStarted : null;
      if (Array.isArray(saved.route)) this.route = saved.route.filter(validRoutePoint).slice(-ROUTE_MAX);
    }
    this.publish(true);
    if (connect) this.connect();
    this.saveTimer = setInterval(() => void this.save(), 60_000);
    this.saveTimer.unref();
    this.staleTimer = setInterval(() => this.expire(), 2000);
    this.staleTimer.unref();
  }

  /** The fix goes stale (tunnel, unplugged receiver): say so rather than keep showing a speed that is no longer true. */
  private expire(): void {
    if (this.cur.lastFix && this.now() - Date.parse(this.cur.lastFix) > STALE_MS && (this.cur.fix || this.cur.speedKmh !== null)) {
      this.cur.fix = false;
      this.cur.speedKmh = null;
      this.previous = null;
      this.publish(true);
    }
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new Socket();
    this.socket = socket;
    this.buffer = '';
    socket.setTimeout(12_000);
    socket.on('connect', () => {
      this.cur.connected = true;
      this.cur.detail = 'GPS connected; waiting for satellites';
      this.publish(true);
      socket.write('?WATCH={"enable":true,"json":true};\n');
    });
    socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      if (this.buffer.length > 30_000) this.buffer = '';
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          this.ingest(JSON.parse(line));
        } catch {
          /* gpsd can send a partial line when the connection restarts */
        }
      }
    });
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {
      this.cur.detail = 'gpsd not reachable. Check GPS setup/service.';
      this.publish(true);
    });
    socket.on('close', () => {
      this.cur.connected = false;
      this.cur.fix = false;
      this.cur.speedKmh = null;
      this.previous = null;
      this.publish(true);
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 3500);
    });
    socket.connect(this.gpsdPort, '127.0.0.1');
  }

  /** One message from gpsd (or from the demo simulator). `SKY` carries satellites, `TPV` the position. */
  ingest(msg: Record<string, unknown>): void {
    if (msg.class === 'SKY') {
      const sats = Array.isArray(msg.satellites) ? (msg.satellites as Array<{ used?: boolean }>) : null;
      this.cur.satellites = sats?.length ?? finite(msg.nSat) ?? null;
      this.cur.usedSatellites = sats ? sats.filter((s) => s.used).length : finite(msg.uSat);
      return this.publish();
    }
    if (msg.class !== 'TPV') return;

    const lat = finite(msg.lat);
    const lon = finite(msg.lon);
    if ((finite(msg.mode) ?? 0) < 2 || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

    const speed = Math.max(0, (finite(msg.speed) ?? 0) * 3.6);
    const accuracy = finite(msg.eph) ?? finite(msg.epx);
    const time = this.now();

    if (this.previous && accuracy !== null && accuracy < MAX_ERROR_M) {
      const age = (time - this.previous.time) / 1000;
      const km = distanceKm(this.previous.lat, this.previous.lon, lat, lon);
      // A jump larger than the car could have driven since the last point is a glitch, not distance.
      if (age > 0 && age < 10 && km < Math.max(0.04, age * 0.08) && speed < 220) this.cur.tripKm += km;
    }
    if (accuracy === null || accuracy < MAX_ERROR_M) this.previous = { lat, lon, time };

    if (!this.cur.tripStarted) this.cur.tripStarted = new Date(time).toISOString();
    this.cur.topSpeedKmh = Math.max(this.cur.topSpeedKmh, Math.min(speed, 300));
    this.cur.connected = true;
    this.cur.fix = true;
    this.cur.lastFix = new Date(time).toISOString();
    this.cur.latitude = lat;
    this.cur.longitude = lon;
    this.cur.speedKmh = speed;
    this.cur.heading = finite(msg.track);
    this.cur.altitudeM = finite(msg.altMSL) ?? finite(msg.alt);
    this.cur.accuracyM = accuracy;
    this.cur.detail = 'Live satellite position';

    const last = this.route.at(-1);
    if (!last || (time - Date.parse(last.at) >= ROUTE_MIN_MS && distanceKm(last.lat, last.lon, lat, lon) >= ROUTE_MIN_KM)) {
      this.route.push({ lat, lon, at: new Date(time).toISOString(), alt: this.cur.altitudeM });
      if (this.route.length > ROUTE_MAX) this.route.shift();
    }
    this.publish();
  }

  async command(action: string): Promise<GpsState> {
    const c = this.cur;
    if (action === 'reset-trip') {
      c.tripKm = 0;
      c.topSpeedKmh = 0;
      c.tripStarted = c.fix ? new Date(this.now()).toISOString() : null;
      this.previous = null;
      this.route = [];
    } else if (action === 'park') {
      if (!c.fix || c.latitude === null || c.longitude === null) throw new Error('Wait for a GPS fix before saving the parking position.');
      c.parked = { latitude: c.latitude, longitude: c.longitude, at: new Date(this.now()).toISOString() };
    } else if (action === 'clear-park') {
      c.parked = null;
    } else {
      throw new Error('Unknown GPS action.');
    }
    await this.save();
    this.publish(true);
    return this.cur;
  }

  /** The recorded breadcrumb, for the offline track map. */
  track(): GpsTrackPoint[] {
    return this.route.map(({ lat, lon, at }) => ({ lat, lon, at }));
  }

  /** GPX 1.1 for offline viewing and sharing. No outside service or API required. */
  gpx(): string {
    const points = this.route.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}">${p.alt === null ? '' : `<ele>${p.alt}</ele>`}<time>${p.at}</time></trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RPI Head Unit" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Head Unit GPS Trip</name><trkseg>${points}</trkseg></trk></gpx>`;
  }

  csv(): string {
    return 'time,latitude,longitude,altitude_m\n' + this.route.map((p) => `${p.at},${p.lat},${p.lon},${p.alt ?? ''}`).join('\n');
  }

  save(): Promise<void> {
    const { tripKm, tripStarted, topSpeedKmh, parked } = this.cur;
    return this.store.write(FILE, { tripKm, tripStarted, topSpeedKmh, parked, route: this.route });
  }

  stop(): void {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.staleTimer);
    clearInterval(this.saveTimer);
    clearTimeout(this.trailing);
    this.socket?.destroy();
    void this.save();
  }

  /**
   * Tell the screens, at most every PUBLISH_MS. The first update after a quiet spell goes out at once; updates inside the window are
   * not dropped but collapsed into one that goes out when the window ends, so the last thing that happened is always delivered.
   */
  private publish(force = false): void {
    const since = this.now() - this.lastPublish;
    if (force || since >= PUBLISH_MS) return this.flush();
    if (this.trailing) return;
    this.trailing = setTimeout(() => this.flush(), PUBLISH_MS - since);
    this.trailing.unref();
  }

  /** Publish the current state now. */
  flush(): void {
    clearTimeout(this.trailing);
    this.trailing = undefined;
    this.lastPublish = this.now();
    this.state.set({ ...this.cur });
  }
}
