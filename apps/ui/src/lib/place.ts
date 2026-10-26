import type { GpsState, WeatherState } from '@headunit/shared';
import { useHeadUnit } from '../store';
import type { Place } from './theme';

/** Where the car is, as best it is known: the live GPS fix first, else the place the weather last used (a saved or typed one). */
export function pickPlace(gps: Pick<GpsState, 'fix' | 'latitude' | 'longitude'> | undefined, weather: Pick<WeatherState, 'location'> | undefined): Place | null {
  if (gps?.fix && gps.latitude !== null && gps.longitude !== null) return { lat: gps.latitude, lon: gps.longitude };
  const w = weather?.location;
  return w ? { lat: w.lat, lon: w.lon } : null;
}

/**
 * The position for the day/night switch. Rounded to a tenth of a degree (about 10 km): sunset moves by less than a minute over
 * that, and the page does not redraw every time the car moves a few metres.
 */
export function usePlace(): Place | null {
  const lat = useHeadUnit((s) => s.svc.gps?.latitude ?? null);
  const lon = useHeadUnit((s) => s.svc.gps?.longitude ?? null);
  const fix = useHeadUnit((s) => s.svc.gps?.fix ?? false);
  const loc = useHeadUnit((s) => s.svc.weather?.location ?? null);
  const place = pickPlace({ fix, latitude: lat, longitude: lon }, { location: loc });
  if (!place) return null;
  return { lat: Math.round(place.lat * 10) / 10, lon: Math.round(place.lon * 10) / 10 };
}
