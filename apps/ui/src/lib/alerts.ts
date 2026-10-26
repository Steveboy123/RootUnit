import type { GarageState, HealthState, PhoneDevice, VehicleKey, VehicleState, WeatherState } from '@headunit/shared';
import { convert, unitLabel } from './format';
import { healthAlert } from './health';
import { metricById, metricLevel } from './metrics';
import { drivingHazard } from './weather';

export interface Alert {
  /** Stable id, so a dismissed alert stays dismissed until its condition clears. */
  id: string;
  level: 'warn' | 'danger';
  text: string;
}

const PHONE_LOW = 15;
/** Weather older than this is not a warning about now. */
const WEATHER_FRESH_MS = 3 * 3600_000;

/** What else the head unit knows that can need attention. Anything missing simply adds no alerts. */
export interface AlertSources {
  health?: HealthState;
  garage?: GarageState;
  weather?: WeatherState;
  /** Epoch ms; passed in so the result depends only on the inputs. */
  now?: number;
}

/** Everything the driver should be told about right now, most severe first. */
export function computeAlerts(
  vehicle: VehicleState | null,
  active: PhoneDevice | undefined,
  units: 'metric' | 'imperial',
  more: AlertSources = {},
): Alert[] {
  const out: Alert[] = [];

  if (vehicle?.connected) {
    const has = (k: VehicleKey) => !vehicle.unsupported?.includes(k); // never alert on a reading the car doesn't provide
    if (vehicle.mil?.on) {
      const n = vehicle.mil.count;
      out.push({ id: 'mil', level: 'warn', text: `Check engine light is on${n > 0 ? ` — ${n} fault code${n === 1 ? '' : 's'} (see Vehicle)` : ''}` });
    }
    const coolant = metricById('coolant');
    const lvl = has('coolantC') ? metricLevel(coolant, vehicle.coolantC) : 'ok';
    if (lvl !== 'ok') {
      const t = Math.round(convert('temp', units, vehicle.coolantC));
      out.push({ id: 'coolant', level: lvl, text: `${lvl === 'danger' ? 'Engine overheating' : 'Coolant running hot'} — ${t}${unitLabel('temp', units)}` });
    }

    const batt = metricById('battery');
    const bl = has('batteryV') ? metricLevel(batt, vehicle.batteryV) : 'ok';
    if (bl !== 'ok') {
      const low = vehicle.batteryV < 13;
      out.push({ id: 'battery', level: bl, text: `${low ? 'Low' : 'High'} battery voltage — ${vehicle.batteryV.toFixed(1)} V` });
    }

    const fuel = metricById('fuel');
    const fl = has('fuelPct') ? metricLevel(fuel, vehicle.fuelPct) : 'ok';
    if (fl !== 'ok') {
      out.push({ id: 'fuel', level: fl, text: `${fl === 'danger' ? 'Fuel nearly empty' : 'Low fuel'} — ${Math.round(vehicle.fuelPct)}%` });
    }
  }

  if (active?.battery && !active.battery.charging && active.battery.percent <= PHONE_LOW) {
    out.push({ id: `phone-${active.id}`, level: 'warn', text: `${active.name} battery low — ${Math.round(active.battery.percent)}%` });
  }

  const pi = healthAlert(more.health);
  if (pi) out.push(pi);

  const overdue = more.garage?.due.filter((d) => d.status === 'overdue') ?? [];
  if (overdue.length > 0) {
    const names = overdue.slice(0, 2).map((d) => d.name).join(', ');
    out.push({ id: 'garage-overdue', level: 'warn', text: overdue.length === 1 ? `${names} is overdue (open Garage)` : `${overdue.length} things overdue: ${names}${overdue.length > 2 ? '…' : ''} (open Garage)` });
  }

  const w = more.weather;
  if (w?.status === 'ok' && w.current && w.fetchedAt !== null && (more.now ?? Date.now()) - w.fetchedAt < WEATHER_FRESH_MS) {
    const hazard = drivingHazard(w.current.code);
    if (hazard) out.push({ id: 'weather-hazard', level: 'warn', text: hazard });
  }

  return out.sort((a, b) => Number(b.level === 'danger') - Number(a.level === 'danger'));
}
