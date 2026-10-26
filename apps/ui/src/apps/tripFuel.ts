import type { TripRecord } from '@headunit/shared';

export interface TripFuel {
  liters: number;
  lPer100: number;
}

/**
 * Fuel used on a trip, estimated from how far the fuel gauge fell and the size of the tank. The gauge is coarse and sloshes, so this is
 * only offered for trips long enough that a drop of a percent or two means something, and only when the tank size is known.
 */
export function tripFuel(trip: Pick<TripRecord, 'distanceKm' | 'fuelUsedPct'>, tankL: number | null): TripFuel | null {
  if (!tankL || tankL <= 0 || trip.fuelUsedPct === undefined || trip.fuelUsedPct <= 0) return null;
  if (trip.distanceKm < 5 || trip.fuelUsedPct < 1) return null;
  const liters = (trip.fuelUsedPct / 100) * tankL;
  const lPer100 = (liters / trip.distanceKm) * 100;
  // Outside this the gauge was refilled or misread, and showing it would only mislead.
  if (lPer100 < 1.5 || lPer100 > 40) return null;
  return { liters: Math.round(liters * 10) / 10, lPer100: Math.round(lPer100 * 10) / 10 };
}
