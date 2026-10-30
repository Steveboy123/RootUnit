import { useState } from 'react';
import { Car, Compass as CompassIcon, ListMusic, MapPin, Music2, Settings as SettingsIcon, Smartphone, SunMedium, Volume2, VolumeX } from 'lucide-react';
import { BatteryIcon, SignalBars, batteryText } from '../components/Indicators';
import { Slider } from '../components/ui';
import { useBestSpeed } from '../lib/driving';
import { convert, formatClock, formatDuration, unitLabel } from '../lib/format';
import { useNow } from '../lib/hooks';
import { compassPoint } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';

export function ClockWidget() {
  const now = useNow(1000);
  const h24 = useHeadUnit((s) => s.settings?.clock24h ?? true);
  const { time, suffix } = formatClock(now, h24);
  return (
    <div className="w-clock">
      <div className="w-clock-time num">
        {time}
        {suffix && <small>{suffix}</small>}
      </div>
      <div className="w-clock-date">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      {/* One dot per second around the minute: a quiet seconds hand. */}
      <i className="w-clock-sec" style={{ transform: `scaleX(${now.getSeconds() / 59})` }} />
    </div>
  );
}

export function TripWidget() {
  const trip = useHeadUnit((s) => s.vehicle?.trip);
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const stats = [
    { label: 'Distance', value: trip ? convert('dist', units, trip.distanceKm).toFixed(1) : '–', unit: unitLabel('dist', units) },
    { label: 'Time', value: trip ? formatDuration(trip.durationS) : '–', unit: '' },
    { label: 'Avg speed', value: trip ? String(Math.round(convert('speed', units, trip.avgSpeedKmh))) : '–', unit: unitLabel('speed', units) },
    { label: 'Top speed', value: trip ? String(Math.round(convert('speed', units, trip.maxSpeedKmh))) : '–', unit: unitLabel('speed', units) },
  ];
  return (
    <div className="w-stats">
      {stats.map((s) => (
        <div key={s.label} className="stat">
          <div className="stat-label">{s.label}</div>
          <div className="stat-value">
            {s.value}
            {s.unit && <small>{s.unit}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function QuickControls() {
  const system = useHeadUnit((s) => s.system);
  const patch = useHeadUnit((s) => s.patchSystem);
  const [liveVol, setLiveVol] = useState<number | null>(null);
  const [liveBri, setLiveBri] = useState<number | null>(null);
  if (!system) return null;
  const muted = system.muted || system.volume === 0;
  return (
    <div className="w-quick" data-no-swipe>
      <div className="w-quick-row">
        <button type="button" className="icon-btn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => patch({ muted: !system.muted })}>
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
        <Slider label="Volume" thick value={system.muted ? 0 : system.volume} onChange={(v) => { setLiveVol(v); patch({ volume: v, muted: false }); }} onCommit={() => setLiveVol(null)} />
        <b className="num">{liveVol ?? (system.muted ? 0 : system.volume)}</b>
      </div>
      <div className="w-quick-row">
        <span className="icon-btn" aria-hidden="true">
          <SunMedium />
        </span>
        <Slider label="Brightness" thick min={5} value={system.brightness} onChange={(v) => { setLiveBri(v); patch({ brightness: v }); }} onCommit={() => setLiveBri(null)} />
        <b className="num">{liveBri ?? system.brightness}</b>
      </div>
    </div>
  );
}

export function LauncherWidget() {
  const go = useHeadUnit((s) => s.go);
  const setMusicTab = useHeadUnit((s) => s.setMusicTab);
  const items = [
    { key: 'aa', label: 'Android Auto', icon: Car, route: 'aa' as const, primary: true },
    { key: 'music', label: 'Music', icon: Music2, route: 'media' as const },
    { key: 'youtube-music', label: 'YouTube Music', icon: ListMusic, route: 'media' as const, tab: 'youtube-music' as const },
    { key: 'settings', label: 'Settings', icon: SettingsIcon, route: 'settings' as const },
  ];
  return (
    <div className="w-launch" data-no-swipe>
      {items.map(({ key, label, icon: Icon, route, primary, tab }) => (
        <button
          key={key}
          type="button"
          className="w-launch-btn"
          data-primary={primary}
          onClick={() => {
            if (tab) setMusicTab(tab);
            go(route);
          }}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Connected phones with battery and signal; tap to open the Phones page. */
export function DevicesWidget() {
  const devices = useHeadUnit((s) => s.devices);
  const go = useHeadUnit((s) => s.go);
  const list = (devices?.devices ?? []).filter((d) => d.connected);
  if (list.length === 0) {
    return (
      <button type="button" className="w-empty" onClick={() => go('devices')} data-no-swipe>
        <span className="w-empty-icon">
          <Smartphone />
        </span>
        <b>No phone connected</b>
      </button>
    );
  }
  return (
    <button type="button" className="w-devices" onClick={() => go('devices')} data-no-swipe aria-label="Open phones">
      {list.map((d) => (
        <div key={d.id} className="w-device" data-active={d.active}>
          <Smartphone size={18} />
          <span className="grow truncate">{d.name}</span>
          <SignalBars level={d.signal} />
          <BatteryIcon percent={d.battery?.percent} charging={d.battery?.charging} size={20} />
          <b className="num">{batteryText(d.battery?.percent)}</b>
        </div>
      ))}
    </button>
  );
}

/** Satellite GPS at a glance: speed, heading and the GPS trip. Tap to open the GPS app. */
export function GpsMini() {
  const g = useSvc('gps');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const openApp = useHeadUnit((s) => s.openApp);
  const speed = useBestSpeed();
  const kmh = g?.fix && g.speedKmh !== null ? g.speedKmh : speed?.kmh ?? null;
  return (
    <button type="button" className="w-gps" onClick={() => openApp('gps')} data-no-swipe>
      <div className="w-head">
        <CompassIcon size={17} /> Satellite GPS <span className="spacer" />
        <span className="badge" data-tone={g?.fix ? 'ok' : 'warn'}>
          {g?.fix ? `${g.usedSatellites ?? '–'} sats` : g?.connected ? 'No fix' : 'No receiver'}
        </span>
      </div>
      <div className="w-gps-speed">
        <strong className="num">{kmh === null ? '—' : Math.round(convert('speed', units, kmh))}</strong>
        <small>{unitLabel('speed', units)}</small>
        {g?.fix && g.heading !== null && (
          <em>
            {compassPoint(g.heading)} {Math.round(g.heading)}°
          </em>
        )}
      </div>
      <div className="w-foot">
        <MapPin size={14} /> Trip {convert('dist', units, g?.tripKm ?? 0).toFixed(1)} {unitLabel('dist', units)}
      </div>
    </button>
  );
}

/** New in RootUnit: a compass rose that turns with the car's heading (from the GPS). */
export function CompassWidget() {
  const g = useSvc('gps');
  const heading = g?.fix && g.heading !== null ? g.heading : null;
  return (
    <div className="w-compass">
      <svg viewBox="-100 -100 200 200" className="w-compass-rose" aria-label={heading === null ? 'Heading unknown' : `Heading ${Math.round(heading)} degrees`} role="img">
        <circle r="92" className="cr-ring" />
        <g className="cr-dial" style={{ transform: `rotate(${-(heading ?? 0)}deg)` }}>
          {Array.from({ length: 72 }, (_, i) => (
            <line key={i} y1={i % 18 === 0 ? -70 : i % 2 === 0 ? -80 : -84} y2="-88" transform={`rotate(${i * 5})`} className={i % 18 === 0 ? 'cr-major' : 'cr-minor'} />
          ))}
          {(['N', 'E', 'S', 'W'] as const).map((d, i) => (
            <text key={d} transform={`rotate(${i * 90}) translate(0 -54)`} textAnchor="middle" dominantBaseline="central" className={d === 'N' ? 'cr-n' : 'cr-d'}>
              {d}
            </text>
          ))}
        </g>
        <path d="M0 -40 L9 6 L0 0 L-9 6 Z" className="cr-car" />
      </svg>
      <div className="w-compass-text">
        <b className="num">{heading === null ? '—' : `${Math.round(heading)}°`}</b>
        <span>{heading === null ? (g?.connected ? 'Waiting for a fix' : 'No GPS') : compassPoint(heading)}</span>
      </div>
    </div>
  );
}
