/** Drawing a GPS track with no map tiles: fit the points into a box, keeping the shape true. */
import { bearingAndDistance } from './units';

export interface LatLon {
  lat: number;
  lon: number;
  /** ISO time of the fix, when known: lets the line stop where the recording stopped instead of leaping across the gap. */
  at?: string;
}

export interface Projection {
  /** Latitude/longitude to x/y pixels in the box. */
  project(p: LatLon): { x: number; y: number };
  /** An SVG path through the points. */
  path: string;
  /** Metres per pixel, for a scale bar (0 when there is nothing to scale). */
  metresPerPx: number;
}

const M_PER_DEG = 111_320;

/** A gap in recording this long (power off, receiver unplugged) is not a stretch of road. */
const MAX_GAP_MS = 15 * 60_000;
/** No road vehicle covers the distance between two fixes this fast: it is a jump, not driving. */
const MAX_SPEED_KMH = 300;

/**
 * Whether the line should lift the pen between two consecutive fixes. A head unit that lost power in one place and woke in another must
 * not draw a straight line across the map between them. Without times nothing is broken.
 */
export function startsNewSegment(prev: LatLon, next: LatLon): boolean {
  if (!prev.at || !next.at) return false;
  const dt = Date.parse(next.at) - Date.parse(prev.at);
  if (!Number.isFinite(dt)) return false;
  if (dt > MAX_GAP_MS) return true;
  const { km } = bearingAndDistance(prev, next);
  if (dt <= 0) return km > 0.5; // clocks disagree: only a big jump matters
  return km > 0.2 && km / (dt / 3_600_000) > MAX_SPEED_KMH;
}

/**
 * Equirectangular projection around the track's own middle: longitude is shrunk by cos(latitude) so a north-south mile and an
 * east-west mile come out the same length. One scale for both axes, so the track is not stretched. A single point (or none) sits in the
 * middle of the box.
 */
export function projectTrack(points: readonly LatLon[], width: number, height: number, pad = 12, extra: readonly LatLon[] = []): Projection {
  const all = [...points, ...extra];
  if (all.length === 0 || width <= 0 || height <= 0) return { project: () => ({ x: width / 2, y: height / 2 }), path: '', metresPerPx: 0 };

  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const availW = Math.max(1, width - pad * 2);
  const availH = Math.max(1, height - pad * 2);
  // A track that is a point or a very short line would zoom in absurdly: never magnify beyond about 20 m across the box.
  const minSpanDeg = 20 / M_PER_DEG;
  const scale = Math.min(availW / Math.max(spanX, minSpanDeg), availH / Math.max(spanY, minSpanDeg));
  const cx = (minLon + maxLon) / 2;
  const cy = (minLat + maxLat) / 2;
  const project = (p: LatLon) => ({ x: width / 2 + (p.lon - cx) * kx * scale, y: height / 2 - (p.lat - cy) * scale });

  const r = (n: number) => Math.round(n * 10) / 10;
  const path = points.map((p, i) => {
    const q = project(p);
    return `${i === 0 || startsNewSegment(points[i - 1]!, p) ? 'M' : 'L'}${r(q.x)},${r(q.y)}`;
  }).join('');
  return { project, path, metresPerPx: M_PER_DEG / scale };
}

/** A round number of metres for a scale bar that is roughly `targetPx` long: 50 m, 200 m, 1 km. */
export function scaleBar(metresPerPx: number, targetPx = 90): { metres: number; px: number } | null {
  if (!(metresPerPx > 0)) return null;
  const raw = metresPerPx * targetPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const metres = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= raw * 1.001).at(-1) ?? pow;
  return { metres, px: metres / metresPerPx };
}
