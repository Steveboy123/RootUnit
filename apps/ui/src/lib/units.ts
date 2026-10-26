import type { Settings } from '@headunit/shared';

type Units = Settings['units'];

const KM_PER_MILE = 1.609344;
const L_PER_US_GAL = 3.785411784;
const L_PER_UK_GAL = 4.54609;

/** Imperial fuel economy is in miles per gallon, and a UK gallon is not a US gallon: pick by the region of the browser's language. */
export function gallonKind(locale: string = typeof navigator === 'undefined' ? 'en-US' : navigator.language): 'uk' | 'us' {
  return /-(GB|IE|AU|NZ)\b/i.test(locale) ? 'uk' : 'us';
}

const litersPerGallon = (kind: 'uk' | 'us') => (kind === 'uk' ? L_PER_UK_GAL : L_PER_US_GAL);

export const kmToDisplay = (km: number, u: Units) => (u === 'metric' ? km : km / KM_PER_MILE);
/** What the user typed, in their units, back to the kilometres the server stores. */
export const displayToKm = (v: number, u: Units) => (u === 'metric' ? v : v * KM_PER_MILE);
export const distUnit = (u: Units) => (u === 'metric' ? 'km' : 'mi');
export const speedUnit = (u: Units) => (u === 'metric' ? 'km/h' : 'mph');

export const litersToDisplay = (l: number, u: Units, gallon = gallonKind()) => (u === 'metric' ? l : l / litersPerGallon(gallon));
export const displayToLiters = (v: number, u: Units, gallon = gallonKind()) => (u === 'metric' ? v : v * litersPerGallon(gallon));
export const volumeUnit = (u: Units, gallon = gallonKind()) => (u === 'metric' ? 'L' : gallon === 'uk' ? 'UK gal' : 'US gal');

/** Litres per 100 km becomes miles per gallon when imperial. 0 or less has no economy. */
export function economyToDisplay(lPer100: number, u: Units, gallon = gallonKind()): number | null {
  if (!(lPer100 > 0)) return null;
  // 100 km is 100/1.609 miles; `lPer100` litres is lPer100 / litersPerGallon gallons.
  return u === 'metric' ? lPer100 : (100 / KM_PER_MILE) * (litersPerGallon(gallon) / lPer100);
}
export const economyUnit = (u: Units, gallon = gallonKind()) => (u === 'metric' ? 'L/100 km' : gallon === 'uk' ? 'mpg (UK)' : 'mpg (US)');

export const celsiusToDisplay = (c: number, u: Units) => (u === 'metric' ? c : (c * 9) / 5 + 32);
export const tempUnit = (u: Units) => (u === 'metric' ? '°C' : '°F');

/** "1,234" style grouping with no decimals unless asked. */
export const fmt = (n: number, decimals = 0) => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** 3725 -> "1 h 02 min"; 540 -> "9 min"; 45 -> "45 s". For durations that are read, not counted down. */
export function humanDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m === 60 ? 59 : m).padStart(2, '0')} min`;
}

/** Compass point for a heading in degrees: 0 = N, 90 = E. */
export function compassPoint(deg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Initial great-circle bearing from A to B in degrees, and the distance in km. */
export function bearingAndDistance(from: { lat: number; lon: number }, to: { lat: number; lon: number }): { bearing: number; km: number } {
  const rad = Math.PI / 180;
  const dLon = (to.lon - from.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLon);
  const bearing = ((Math.atan2(y, x) / rad) + 360) % 360;
  const dLat = (to.lat - from.lat) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLon / 2) ** 2;
  return { bearing, km: 12742 * Math.asin(Math.min(1, Math.sqrt(h))) };
}

/** A short distance for walking back to the car: metres under a kilometre, otherwise kilometres. Imperial: feet and miles. */
export function shortDistance(km: number, u: Units): string {
  if (u === 'metric') return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
  const miles = km / KM_PER_MILE;
  return miles < 0.1 ? `${Math.round((miles * 5280) / 10) * 10} ft` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}
