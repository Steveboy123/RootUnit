import type { ReactNode } from 'react';
import { ArrowUp, CloudOff, Cpu, Hourglass, MapPinned, Route, Wrench, type LucideIcon } from 'lucide-react';
import type { SceneIcon } from '@headunit/shared';
import { SceneGlyph } from '../components/glyphs';
import { Badge, type Tone } from '../components/ui';
import { powerStatus, tempTone, uptimeText } from '../lib/health';
import { useNow } from '../lib/hooks';
import { applyScene, sceneSummary } from '../lib/scenes';
import { countdownText } from '../lib/stopwatch';
import { bearingAndDistance, celsiusToDisplay, compassPoint, distUnit, fmt, humanDuration, kmToDisplay, shortDistance, tempUnit } from '../lib/units';
import { describeWeather, drivingHazard, weatherIcon } from '../lib/weather';
import { ActionChip } from '../shell/QuickPanel';
import { useHeadUnit, useSvc } from '../store';

/** The frame every glance widget shares: a title line, the thing itself, one line under it. Tapping opens the app behind it. */
function Glance({ icon: Icon, title, aside, onOpen, foot, children }: { icon: LucideIcon; title: string; aside?: ReactNode; onOpen?: () => void; foot?: ReactNode; children: ReactNode }) {
  const body = (
    <>
      <div className="w-head">
        <Icon size={17} /> <span className="truncate">{title}</span>
        <span className="spacer" />
        {aside}
      </div>
      <div className="w-glance-body">{children}</div>
      {foot && <div className="w-foot truncate">{foot}</div>}
    </>
  );
  return onOpen ? (
    <button type="button" className="w-glance" onClick={onOpen} data-no-swipe>
      {body}
    </button>
  ) : (
    <div className="w-glance">{body}</div>
  );
}

const useUnits = () => useHeadUnit((s) => s.settings?.units ?? 'metric');
const useOpenApp = () => useHeadUnit((s) => s.openApp);

export function WeatherWidget() {
  const w = useSvc('weather');
  const units = useUnits();
  const openApp = useOpenApp();
  const go = useHeadUnit((s) => s.go);
  if (!w) return null;
  if (w.status === 'off') return <Glance icon={CloudOff} title="Weather" onOpen={() => go('settings')}><span className="w-note">Switched off. Tap to turn it on in Settings.</span></Glance>;
  if (!w.current) {
    const text = w.status === 'no-location' ? 'Waiting for a GPS fix or a saved place.' : w.status === 'error' ? 'Can’t reach the forecast right now.' : 'Loading…';
    return <Glance icon={CloudOff} title="Weather" onOpen={() => openApp('weather')}><span className="w-note">{text}</span></Glance>;
  }
  const Icon = weatherIcon(w.current.code, w.current.isDay);
  const today = w.daily[0];
  const hazard = drivingHazard(w.current.code);
  return (
    <Glance
      icon={Icon}
      title={w.location?.name ?? 'Weather'}
      onOpen={() => openApp('weather')}
      aside={hazard ? <Badge tone="warn">Take care</Badge> : undefined}
      foot={hazard ?? (today ? `High ${Math.round(celsiusToDisplay(today.maxC, units))}° · Low ${Math.round(celsiusToDisplay(today.minC, units))}°${today.rainPct !== null ? ` · Rain ${today.rainPct}%` : ''}` : undefined)}
    >
      <span className="w-big-icon fx">
        <Icon />
      </span>
      <span className="w-big num">
        {Math.round(celsiusToDisplay(w.current.tempC, units))}
        <small>{tempUnit(units)}</small>
      </span>
      <span className="w-sub">{describeWeather(w.current.code).label}</span>
    </Glance>
  );
}

export function HealthWidget() {
  const h = useSvc('health');
  const openApp = useOpenApp();
  if (!h) return null;
  if (!h.available) return <Glance icon={Cpu} title="System" onOpen={() => openApp('system')}><span className="w-note">No Raspberry Pi readings on this machine.</span></Glance>;
  const power = powerStatus(h.throttle);
  const tone: Tone | undefined = tempTone(h.cpuTempC);
  return (
    <Glance icon={Cpu} title="System" onOpen={() => openApp('system')} aside={<Badge tone={power.tone}>{power.short}</Badge>} foot={`Up ${uptimeText(h.uptimeS)}${h.diskFreeGb !== null ? ` · ${fmt(h.diskFreeGb, 1)} GB free` : ''}`}>
      <span className="w-big num" data-tone={tone}>
        {h.cpuTempC === null ? '–' : Math.round(h.cpuTempC)}
        <small>°C</small>
      </span>
      <span className="w-sub">{h.cpuLoadPct === null ? '' : `CPU ${Math.round(h.cpuLoadPct)}%`}</span>
    </Glance>
  );
}

export function TripsTodayWidget() {
  const t = useSvc('trips');
  const units = useUnits();
  const openApp = useOpenApp();
  if (!t) return null;
  const km = t.today.distanceKm + (t.active?.distanceKm ?? 0);
  const n = t.today.trips + (t.active ? 1 : 0);
  return (
    <Glance icon={Route} title="Today" onOpen={() => openApp('trips')} aside={t.active ? <Badge tone="ok" live>{t.active.paused ? 'Stopped' : 'Driving'}</Badge> : undefined} foot={`${n} trip${n === 1 ? '' : 's'} · ${humanDuration(t.today.durationS + (t.active?.durationS ?? 0))}`}>
      <span className="w-big num">
        {fmt(kmToDisplay(km, units), km < 100 ? 1 : 0)}
        <small>{distUnit(units)}</small>
      </span>
      <span className="w-sub">
        this week {fmt(kmToDisplay(t.week.distanceKm, units), 0)} {distUnit(units)}
      </span>
    </Glance>
  );
}

export function GarageWidget() {
  const g = useSvc('garage');
  const openApp = useOpenApp();
  if (!g) return null;
  const next = g.due.filter((d) => d.status !== 'ok').slice(0, 3);
  if (next.length === 0) {
    return (
      <Glance icon={Wrench} title="Garage" onOpen={() => openApp('garage')}>
        <span className="w-note">{g.services.length + g.docs.length === 0 ? 'Add your service and document dates so nothing is missed.' : 'Everything is up to date.'}</span>
      </Glance>
    );
  }
  const overdue = next.some((d) => d.status === 'overdue');
  return (
    <Glance icon={Wrench} title="Garage" onOpen={() => openApp('garage')} aside={<Badge tone={overdue ? 'danger' : 'warn'}>{overdue ? 'Overdue' : 'Due soon'}</Badge>}>
      <ul className="w-list">
        {next.map((d) => (
          <li key={`${d.kind}-${d.id}`} data-tone={d.status === 'overdue' ? 'danger' : 'warn'}>
            <b className="truncate">{d.name}</b> <span className="truncate">{d.detail}</span>
          </li>
        ))}
      </ul>
    </Glance>
  );
}

export function FindCarWidget() {
  const gps = useSvc('gps');
  const units = useUnits();
  const openApp = useOpenApp();
  if (!gps) return null;
  const parked = gps.parked;
  if (!parked) return <Glance icon={MapPinned} title="Find my car" onOpen={() => openApp('findcar')}><span className="w-note">No parking spot saved. Tap to save one.</span></Glance>;
  const here = gps.fix && gps.latitude !== null && gps.longitude !== null ? { lat: gps.latitude, lon: gps.longitude } : null;
  const nav = here ? bearingAndDistance(here, { lat: parked.latitude, lon: parked.longitude }) : null;
  const facing = gps.heading !== null && (gps.speedKmh ?? 0) > 3 ? gps.heading : 0;
  return (
    <Glance icon={MapPinned} title="Find my car" onOpen={() => openApp('findcar')} foot={`Parked ${humanDuration(Math.max(0, (Date.now() - Date.parse(parked.at)) / 1000))} ago`}>
      {nav ? (
        <>
          <span className="w-arrow" style={{ transform: `rotate(${nav.bearing - facing}deg)` }} aria-hidden="true">
            <ArrowUp size={30} strokeWidth={3} />
          </span>
          <span className="w-big num">{shortDistance(nav.km, units)}</span>
          <span className="w-sub">{compassPoint(nav.bearing)}</span>
        </>
      ) : (
        <span className="w-note">Waiting for a GPS fix to point the way.</span>
      )}
    </Glance>
  );
}

export function TimersWidget() {
  const t = useSvc('timers');
  const now = useNow(1000).getTime();
  const openApp = useOpenApp();
  if (!t) return null;
  const items = [...t.items].sort((a, b) => a.endsAt - b.endsAt).slice(0, 3);
  return (
    <Glance icon={Hourglass} title="Timers" onOpen={() => openApp('timers')}>
      {items.length === 0 ? (
        <span className="w-note">Nothing running. Tap to start a timer.</span>
      ) : (
        <ul className="w-list">
          {items.map((i) => (
            <li key={i.id}>
              <b className="truncate">{i.label}</b> <span className="num">{countdownText(Math.max(0, (i.endsAt - now) / 1000))}</span>
            </li>
          ))}
        </ul>
      )}
    </Glance>
  );
}

export function ScenesWidget() {
  const scenes = useSvc('scenes');
  const toast = useHeadUnit((s) => s.showToast);
  const openApp = useOpenApp();
  if (!scenes) return null;
  if (scenes.length === 0)
    return (
      <button type="button" className="w-empty" onClick={() => openApp('scenes')} data-no-swipe>
        <b>No scenes yet</b>
        <span>A scene sets the look, the lights and the volume together. Tap to make one.</span>
      </button>
    );
  return (
    <div className="w-chips" data-no-swipe>
      {scenes.map((s) => (
        <button key={s.id} type="button" className="chip" onClick={async () => toast(sceneSummary(s, await applyScene(s)))}>
          <SceneGlyph icon={s.icon as SceneIcon} size={16} />
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function ActionsWidget() {
  const actions = useSvc('actions');
  const openApp = useOpenApp();
  if (!actions) return null;
  if (actions.length === 0)
    return (
      <button type="button" className="w-empty" onClick={() => openApp('actions')} data-no-swipe>
        <b>No quick actions yet</b>
        <span>Tap to add a button for a garage door or a light.</span>
      </button>
    );
  return (
    <div className="w-chips" data-no-swipe>
      {actions.map((a) => (
        <ActionChip key={a.id} id={a.id} name={a.name} icon={a.icon} confirm={a.confirm} />
      ))}
    </div>
  );
}
