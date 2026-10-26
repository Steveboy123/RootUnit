import { AlertTriangle, ArrowUp, Gauge as GaugeIcon, Music2, Wrench } from 'lucide-react';
import { AlbumArt } from '../components/AlbumArt';
import { Gauge } from '../components/Gauge';
import { Transport } from '../components/Transport';
import { Eq, Meter, type Tone } from '../components/ui';
import { useBestSpeed } from '../lib/driving';
import { convert, unitLabel } from '../lib/format';
import { metricById, metricLevel, reading } from '../lib/metrics';
import { useNowPlaying } from '../lib/nowPlaying';
import { celsiusToDisplay, compassPoint, distUnit, fmt, humanDuration, kmToDisplay, tempUnit } from '../lib/units';
import { weatherIcon } from '../lib/weather';
import { RPM_ZONES } from '../widgets/gauges';
import { useHeadUnit, useSvc } from '../store';

/** The screen to leave on while driving: one big speed (and the revs when the car reports them), what is playing, this trip, and only the warnings that matter. */
export function DrivePage() {
  return (
    <div className="page fixed drive">
      <SpeedCard />
      <div className="drive-side stagger">
        <PlayerCard />
        <TripCard />
        <EngineCard />
      </div>
    </div>
  );
}

function SpeedCard() {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const best = useBestSpeed();
  const gps = useSvc('gps');
  const weather = useSvc('weather');
  const garage = useSvc('garage');
  const health = useSvc('health');
  const rpmLive = useHeadUnit((s) => reading(s.vehicle, metricById('rpm')));
  const go = useHeadUnit((s) => s.go);
  const openApp = useHeadUnit((s) => s.openApp);

  const val = best ? convert('speed', units, best.kmh) : 0;
  const max = units === 'metric' ? 240 : 160;
  const due = garage?.due.find((d) => d.status !== 'ok');
  const WeatherIcon = weather?.current ? weatherIcon(weather.current.code, weather.current.isDay) : null;
  const power = health?.throttle?.underVoltageNow;

  return (
    <section className="card drive-speed">
      <div className="drive-gauges" data-rpm={rpmLive !== null}>
        <div className="drive-main-gauge">
          <Gauge value={val} min={0} max={max} major={units === 'metric' ? 40 : 20} live={best !== null} peakHold display={best ? String(Math.round(val)) : '—'} unit={unitLabel('speed', units)} label={best ? (best.source === 'obd' ? 'CAR SPEED' : 'GPS SPEED') : 'NO SPEED'} />
        </div>
        {rpmLive !== null && (
          <div className="drive-rpm">
            <Gauge value={rpmLive / 1000} min={0} max={8} major={2} zones={RPM_ZONES} shiftAt={6} display={String(Math.round(rpmLive / 100) * 100)} unit="rpm" level={metricLevel(metricById('rpm'), rpmLive)} />
          </div>
        )}
      </div>
      <div className="drive-chips">
        {gps?.fix && gps.heading !== null && (
          <span className="pill">
            <ArrowUp size={16} style={{ transform: `rotate(${Math.round(gps.heading)}deg)` }} />
            <b>{compassPoint(gps.heading)}</b> {Math.round(gps.heading)}°
          </span>
        )}
        {WeatherIcon && weather?.current && (
          <button type="button" className="pill" onClick={() => openApp('weather')}>
            <WeatherIcon size={16} />
            <b>{Math.round(celsiusToDisplay(weather.current.tempC, units))}</b>
            {tempUnit(units)}
          </button>
        )}
        {due && (
          <button type="button" className={`pill ${due.status === 'overdue' ? 'danger' : 'warn'}`} onClick={() => openApp('garage')}>
            <Wrench size={16} />
            {due.name} <span className="dim">{due.detail}</span>
          </button>
        )}
        {power && (
          <button type="button" className="pill danger" onClick={() => openApp('system')}>
            <AlertTriangle size={16} />
            Low power
          </button>
        )}
        {!best && (
          <button type="button" className="pill warn" onClick={() => go('vehicle')}>
            <GaugeIcon size={16} />
            No speed source
          </button>
        )}
      </div>
    </section>
  );
}

function PlayerCard() {
  const np = useNowPlaying();
  const go = useHeadUnit((s) => s.go);
  return (
    <section className="card drive-player" style={{ ['--i' as string]: 0 }}>
      {np ? (
        <>
          <button type="button" className="drive-art" onClick={() => go('nowplaying')} aria-label="Open the player" data-no-swipe>
            <AlbumArt artUrl={np.artUrl} playing={np.playing} size="sm" />
          </button>
          <div className="grow col" style={{ gap: 6 }}>
            <button type="button" className="drive-np-text" onClick={() => go('nowplaying')} data-no-swipe>
              <b className="truncate">{np.title}</b>
              <span className="dim truncate">
                {np.artist} · {np.sourceLabel}
              </span>
            </button>
            {np.progressMs !== null && np.durationMs !== null ? (
              <div className="w-np-bar">
                <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, np.progressMs / np.durationMs))})` }} />
              </div>
            ) : (
              <span className="row dim" style={{ gap: 6, fontSize: '0.75rem', fontWeight: 700 }}>
                <Eq on={np.playing} /> LIVE
              </span>
            )}
          </div>
          <Transport size="sm" />
        </>
      ) : (
        <button type="button" className="drive-empty" onClick={() => go('media')}>
          <Music2 size={22} />
          Nothing playing. Open Music
        </button>
      )}
    </section>
  );
}

function TripCard() {
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const trips = useSvc('trips');
  const obd = useHeadUnit((s) => s.vehicle?.trip);
  const openApp = useHeadUnit((s) => s.openApp);
  const active = trips?.active;
  const last = trips?.recent[0];
  // This trip while one is open; otherwise the trip before it; otherwise what the car's own trip computer says.
  const view = active
    ? { title: 'This trip', km: active.distanceKm, durationS: active.durationS, avgKmh: active.movingS > 0 ? (active.distanceKm / active.movingS) * 3600 : 0, tag: active.paused ? 'Stopped' : 'Driving' }
    : last
      ? { title: 'Last trip', km: last.distanceKm, durationS: last.durationS, avgKmh: last.avgSpeedKmh, tag: new Date(last.startedAt).toLocaleDateString(undefined, { weekday: 'short' }) }
      : obd
        ? { title: 'Trip', km: obd.distanceKm, durationS: obd.durationS, avgKmh: obd.avgSpeedKmh, tag: 'Since start' }
        : null;
  return (
    <button type="button" className="card drive-trip" onClick={() => openApp('trips')} data-no-swipe style={{ ['--i' as string]: 1 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">{view?.title ?? 'Trip'}</span>
        {view && <span className="badge" data-tone={active && !active.paused ? 'ok' : undefined}>{view.tag}</span>}
      </div>
      {view ? (
        <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="stat">
            <div className="stat-value">
              {fmt(kmToDisplay(view.km, units), view.km < 100 ? 1 : 0)}
              <small>{distUnit(units)}</small>
            </div>
          </div>
          <div className="stat">
            <div className="stat-value">{humanDuration(view.durationS)}</div>
          </div>
          <div className="stat">
            <div className="stat-value">
              {Math.round(convert('speed', units, view.avgKmh))}
              <small>avg</small>
            </div>
          </div>
        </div>
      ) : (
        <div className="dim">No trips yet</div>
      )}
    </button>
  );
}

function EngineCard() {
  const v = useHeadUnit((s) => s.vehicle);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const go = useHeadUnit((s) => s.go);
  const rows = (['coolant', 'fuel', 'battery'] as const).map((id) => {
    const m = metricById(id);
    const raw = reading(v, m);
    const level = raw === null ? 'ok' : metricLevel(m, raw);
    const tone: Tone | undefined = level === 'ok' ? undefined : level;
    return { id, m, raw, tone };
  });
  const live = rows.some((r) => r.raw !== null);
  return (
    <button type="button" className="card drive-engine" onClick={() => go('vehicle')} data-no-swipe style={{ ['--i' as string]: 2 }}>
      {live ? (
        rows.map(({ id, m, raw, tone }) => (
          <div key={id} className="drive-metric" data-tone={tone}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="eyebrow">{m.label}</span>
              <b className="num">
                {raw === null ? '—' : convert(m.kind, units, raw).toFixed(m.decimals)}
                <small> {unitLabel(m.kind, units)}</small>
              </b>
            </div>
            <Meter label={m.label} value={raw === null ? 0 : raw - m.min} max={m.max - m.min} tone={tone} />
          </div>
        ))
      ) : (
        <div className="dim">Car data unavailable. Tap for details</div>
      )}
    </button>
  );
}
