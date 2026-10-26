import { useState } from 'react';
import { CalendarDays, Download, Gauge, MapPin, Route, Timer, Trash2 } from 'lucide-react';
import type { TripRecord } from '@headunit/shared';
import { BarChart } from '../components/charts';
import { Badge, Cols, ConfirmButton, Empty, Page, Panel, Row, Segment, Sheet, Stat, Stats, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { convert, unitLabel } from '../lib/format';
import { distUnit, economyToDisplay, economyUnit, fmt, humanDuration, kmToDisplay, litersToDisplay, volumeUnit } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';
import { tripFuel } from './tripFuel';

type Period = 'today' | 'week' | 'month' | 'all';
const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
];

const weekday = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
const when = (iso: string | number) =>
  `${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

/** Journeys record themselves: one starts when the car moves off and ends after five minutes standing still. */
export function TripsApp() {
  const trips = useSvc('trips');
  const garage = useSvc('garage');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const { run } = useAction();
  const [open, setOpen] = useState<TripRecord | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  if (!trips) return null;

  const d = (km: number) => fmt(kmToDisplay(km, units), km < 100 ? 1 : 0);
  const speed = (kmh: number) => Math.round(convert('speed', units, kmh));
  const chart = trips.daily.map((x) => ({
    label: x.day.slice(8),
    title: `${weekday(x.day)} ${x.day.slice(8)}/${x.day.slice(5, 7)}`,
    value: Math.round(kmToDisplay(x.km, units) * 10) / 10,
  }));
  const total = trips[period];

  return (
    <Page
      subtitle="Trips record themselves: one starts when you drive off and ends after five minutes standing still."
      actions={
        <>
          <a className="btn small" href="/api/trips.csv" download="trips.csv">
            <Download size={16} /> CSV
          </a>
          {trips.all.trips > 0 && <ConfirmButton className="btn small danger" icon={Trash2} label="Clear all" confirmLabel="Tap again to delete all" onConfirm={() => run(() => apiRequest('/api/trips?confirm=1', 'DELETE'), 'All trips deleted')} />}
        </>
      }
    >
      {trips.active && (
        <section className="card trip-live">
          <span className="trip-live-road fx" aria-hidden />
          <div className="row">
            <span className="trip-live-dot fx" aria-hidden />
            <b className="grow">Driving now</b>
            <Badge tone="ok">{trips.active.paused ? 'Stopped' : 'Recording'}</Badge>
          </div>
          <Stats cols={3}>
            <Stat label="Distance" value={d(trips.active.distanceKm)} unit={distUnit(units)} />
            <Stat label="Time" value={humanDuration(trips.active.durationS)} />
            <Stat label="Top speed" value={speed(trips.active.maxSpeedKmh)} unit={unitLabel('speed', units)} />
          </Stats>
        </section>
      )}

      <section className="card trip-hero">
        <div className="trip-hero-num" key={period}>
          <span className="eyebrow">{PERIODS.find((p) => p.value === period)?.label}</span>
          <b className="num">
            {d(total.distanceKm)}
            <small>{distUnit(units)}</small>
          </b>
          <span className="dim">
            {total.trips} trip{total.trips === 1 ? '' : 's'} · {humanDuration(total.durationS)} at the wheel
          </span>
        </div>
        <Segment label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </section>

      <Cols min={360}>
        <Panel title={`Last 14 days · ${distUnit(units)}`} icon={CalendarDays}>
          <BarChart data={chart} unit={distUnit(units)} />
        </Panel>

        <Panel title="Recent trips" icon={MapPin}>
          {trips.recent.length === 0 ? (
            <Empty icon={Route} title="No trips yet">
              Drive somewhere with the OBD adapter or the GPS connected, and your journeys will appear here.
            </Empty>
          ) : (
            <div className="list stagger">
              {trips.recent.slice(0, 12).map((t, i) => (
                <div key={t.id} style={{ ['--i' as string]: i }}>
                  <Row icon={Route} label={when(t.startedAt)} hint={`${humanDuration(t.durationS)} · avg ${speed(t.avgSpeedKmh)} ${unitLabel('speed', units)}`} right={<b className="num">{`${d(t.distanceKm)} ${distUnit(units)}`}</b>} onClick={() => setOpen(t)} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Cols>

      {open && (
        <Sheet title="Trip" onClose={() => setOpen(null)}>
          <TripDetails
            trip={open}
            tankL={garage?.vehicle.tankL ?? null}
            onDelete={() =>
              run(async () => {
                await apiRequest(`/api/trips/${open.id}`, 'DELETE');
                setOpen(null);
              }, 'Trip deleted')
            }
          />
        </Sheet>
      )}
    </Page>
  );
}

function TripDetails({ trip, tankL, onDelete }: { trip: TripRecord; tankL: number | null; onDelete: () => void }) {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const fuel = tripFuel(trip, tankL);
  const econ = fuel ? economyToDisplay(fuel.lPer100, units) : null;
  const speed = (kmh: number) => Math.round(convert('speed', units, kmh));
  return (
    <>
      <p className="dim">
        {new Date(trip.startedAt).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
        {' to '}
        {new Date(trip.endedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </p>
      <Stats>
        <Stat label="Distance" value={fmt(kmToDisplay(trip.distanceKm, units), 1)} unit={distUnit(units)} />
        <Stat label="Time" value={humanDuration(trip.durationS)} hint={`${humanDuration(trip.movingS)} moving`} />
        <Stat label="Average" value={speed(trip.avgSpeedKmh)} unit={unitLabel('speed', units)} />
        <Stat label="Top speed" value={speed(trip.maxSpeedKmh)} unit={unitLabel('speed', units)} />
        {fuel && econ !== null && <Stat label="Fuel (estimate)" value={fmt(litersToDisplay(fuel.liters, units), 1)} unit={volumeUnit(units)} hint={`${fmt(econ, 1)} ${economyUnit(units)} from the fuel gauge`} />}
      </Stats>
      <div className="row dim" style={{ fontSize: '0.85rem' }}>
        {trip.source === 'obd' ? <Gauge size={16} /> : <Timer size={16} />} Speed from {trip.source === 'obd' ? 'the car (OBD)' : 'GPS'}.
      </div>
      <div className="row">
        <ConfirmButton label="Delete trip" icon={Trash2} onConfirm={onDelete} />
      </div>
    </>
  );
}
