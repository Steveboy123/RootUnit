import { useState } from 'react';
import { CloudOff, MapPin, RefreshCw, Search, Sunrise } from 'lucide-react';
import { Banner, Cols, DrivingGate, Empty, Page, Panel, Row, Stat, Stats, TextField, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { celsiusToDisplay, fmt, tempUnit } from '../lib/units';
import { describeWeather, drivingHazard, weatherIcon } from '../lib/weather';
import { useHeadUnit, useSvc } from '../store';

/** "2024-06-21T04:43" (already in the place's own time zone) as a clock time. */
function clock(iso: string, h24: boolean): string {
  const [h = 0, m = 0] = iso.slice(11, 16).split(':').map(Number);
  if (h24) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export function WeatherApp() {
  const w = useSvc('weather');
  const enabled = useHeadUnit((s) => s.settings?.weather ?? true);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const { busy, run } = useAction();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[] | null>(null);
  if (!w) return null;

  if (!enabled || w.status === 'off') {
    return (
      <Page>
        <Empty
          icon={CloudOff}
          title="Weather is off"
          action={
            <button type="button" className="btn primary" onClick={() => patchSettings({ weather: true })}>
              Turn weather on
            </button>
          }
        >
          The forecast comes from open-meteo.com, a free service. Only the car&rsquo;s position, rounded to about a kilometre, is sent.
        </Empty>
      </Page>
    );
  }

  const search = () =>
    run(async () => setPlaces(await apiRequest<Place[]>(`/api/weather/places?q=${encodeURIComponent(query)}`)));
  const choose = (p: Place) =>
    run(async () => {
      await apiRequest('/api/weather/place', 'PUT', { lat: p.lat, lon: p.lon, name: p.name });
      setPlaces(null);
      setQuery('');
    }, `Weather for ${p.name}`);

  const cur = w.current;
  const Icon = cur ? weatherIcon(cur.code, cur.isDay) : null;
  const today = w.daily[0];
  const hazard = cur ? drivingHazard(cur.code) : null;
  const where = w.location ? (w.location.name ?? `${w.location.lat.toFixed(2)}, ${w.location.lon.toFixed(2)}`) : null;
  const t = (c: number) => `${Math.round(celsiusToDisplay(c, units))}°`;
  // The week's coldest and warmest, so each day's bar sits on one shared scale.
  const lo = Math.min(...w.daily.map((d) => d.minC));
  const hi = Math.max(...w.daily.map((d) => d.maxC));
  const span = Math.max(1, hi - lo);
  const sky = cur ? `${describeWeather(cur.code).kind}-${cur.isDay ? 'day' : 'night'}` : 'cloud-day';

  return (
    <Page
      subtitle={where ? `${where}${w.location?.source === 'gps' ? ' · from GPS' : w.location?.source === 'manual' ? ' · chosen place' : ' · last known place'}` : undefined}
      actions={
        <button type="button" className="btn small" disabled={busy || w.status === 'loading'} onClick={() => void run(() => apiRequest('/api/weather/refresh', 'POST'))}>
          <RefreshCw size={16} className={w.status === 'loading' ? 'spin' : ''} /> Refresh
        </button>
      }
    >
      {hazard && <Banner tone="warn">{hazard}</Banner>}
      {w.status === 'error' && <Banner tone="warn" icon={CloudOff}>{w.error ?? 'The weather could not be loaded.'} {cur ? 'Showing the last forecast.' : ''}</Banner>}

      {cur && Icon ? (
        <Cols min={320}>
          <section className="card panel wx-hero" data-sky={sky}>
            <span className="wx-sky fx" aria-hidden />
            <div className="wx-now">
              <span className="wx-icon fx">
                <Icon size={84} strokeWidth={1.5} />
              </span>
              <div>
                <div className="wx-temp num">
                  {Math.round(celsiusToDisplay(cur.tempC, units))}
                  <small>{tempUnit(units)}</small>
                </div>
                <div className="wx-label">{describeWeather(cur.code).label}</div>
                <div className="dim small">Feels like {t(cur.feelsC)}</div>
              </div>
            </div>
            <Stats>
              <Stat label="Wind" value={fmt(units === 'metric' ? cur.windKmh : cur.windKmh / 1.609344)} unit={units === 'metric' ? 'km/h' : 'mph'} />
              <Stat label="Humidity" value={Math.round(cur.humidityPct)} unit="%" />
              {today && <Stat label="Sunrise" value={clock(today.sunrise, h24)} />}
              {today && <Stat label="Sunset" value={clock(today.sunset, h24)} />}
            </Stats>
          </section>

          <Panel title="Next days" icon={Sunrise}>
            <div className="list stagger">
              {w.daily.map((d, i) => {
                const DIcon = weatherIcon(d.code, true);
                return (
                  <div key={d.date} style={{ ['--i' as string]: i }}>
                    <Row
                      icon={DIcon}
                      label={i === 0 ? 'Today' : new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}
                      hint={`${describeWeather(d.code).label}${d.rainPct !== null && d.rainPct >= 20 ? ` · ${d.rainPct}% rain` : ''}`}
                      right={
                        <span className="wx-range num">
                          <small>{t(d.minC)}</small>
                          <span className="wx-bar" aria-hidden>
                            <i style={{ left: `${((d.minC - lo) / span) * 100}%`, right: `${100 - ((d.maxC - lo) / span) * 100}%` }} />
                          </span>
                          {t(d.maxC)}
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>
          </Panel>
        </Cols>
      ) : (
        <Panel>
          <Empty icon={w.status === 'no-location' ? MapPin : CloudOff} title={w.status === 'no-location' ? 'No place yet' : w.status === 'loading' ? 'Loading the forecast…' : 'No forecast yet'}>
            {w.status === 'no-location' ? 'There is no GPS fix and no place chosen. Search for your town below.' : 'It will appear here as soon as the head unit can reach the weather service.'}
          </Empty>
        </Panel>
      )}

      <Panel title="Place" icon={MapPin}>
        <DrivingGate what="Searching">
          <form
            className="row" style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length >= 2) void search();
            }}
          >
            <TextField label="Search for a town" value={query} onChange={setQuery} placeholder="Leeds" maxLength={60} className="grow" />
            <button type="submit" className="btn primary" disabled={busy || query.trim().length < 2}>
              <Search size={16} /> Search
            </button>
          </form>
          {places && (
            <div className="list">
              {places.length === 0 && <small className="dim">Nothing found. Try another spelling.</small>}
              {places.map((p) => (
                <Row key={`${p.lat}${p.lon}`} icon={MapPin} label={p.name} hint={p.detail} onClick={() => void choose(p)} />
              ))}
            </div>
          )}
        </DrivingGate>
        {w.location?.source !== 'gps' && (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => apiRequest('/api/weather/place', 'DELETE'), 'Following the GPS again')}>
            <MapPin size={16} /> Follow the car&rsquo;s GPS instead
          </button>
        )}
      </Panel>
    </Page>
  );
}
