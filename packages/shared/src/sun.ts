/**
 * Sunrise and sunset from latitude/longitude alone, offline (the "sunrise equation", accurate to about a minute away from the poles).
 * The head unit uses it to switch between the day and night look at the real dusk where the car is, with no network.
 */

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545.0;
const DAY_MS = 86_400_000;

export interface SunTimes {
  /** Null in polar night or midnight sun. */
  sunrise: Date | null;
  sunset: Date | null;
  /** Set when the sun does not cross the horizon that day. */
  polar: 'day' | 'night' | null;
}

const toJulian = (ms: number) => ms / DAY_MS + J1970;
const fromJulian = (j: number) => new Date((j - J1970) * DAY_MS);

/**
 * Sunrise and sunset of the local solar day that `date` falls in at (lat, lon). `lon` is positive east.
 * Both are real instants (compare them with `Date.now()`), not clock strings, so time zones never enter into it.
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  // The solar day number for this longitude: local mean solar noon is at JD = J2000 + n - lon/360.
  const n = Math.round(toJulian(date.getTime()) - J2000 - 0.0009 + lon / 360);
  const jStar = n - lon / 360 + 0.0009;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  // -0.833°: the sun's radius plus atmospheric refraction, so this is when the upper limb touches the horizon.
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const h = Math.acos(cosH) / (2 * Math.PI);
  return { sunrise: fromJulian(transit - h), sunset: fromJulian(transit + h), polar: null };
}

/**
 * Is it dark at (lat, lon) right now? `marginMin` minutes shift both edges inwards so the night look starts a little before sunset and
 * ends a little after sunrise (twilight). Polar day and night are answered from the season.
 */
export function isNightAt(now: Date, lat: number, lon: number, marginMin = 20): boolean {
  const margin = marginMin * 60_000;
  const t = now.getTime();
  const today = sunTimes(now, lat, lon);
  if (today.polar) return today.polar === 'night';
  // Near midnight the daylight that matters can belong to the previous or the next solar day, so look at all three.
  for (const offset of [-1, 0, 1]) {
    const s = sunTimes(new Date(t + offset * DAY_MS), lat, lon);
    if (s.sunrise && s.sunset && t >= s.sunrise.getTime() + margin && t < s.sunset.getTime() - margin) return false;
  }
  return true;
}
