import { Car, Hourglass, MapPin, Navigation, X } from 'lucide-react';
import { Banner, Cols, Empty, Meter, Page, Panel, Row, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { countdownText } from '../lib/stopwatch';
import { useNow } from '../lib/hooks';
import { bearingAndDistance, compassPoint, shortDistance } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';

const METER = [
  { label: '30 min', s: 1800 },
  { label: '1 h', s: 3600 },
  { label: '90 min', s: 5400 },
  { label: '2 h', s: 7200 },
  { label: '3 h', s: 10800 },
];

/** Remembers where you parked, points the way back to it, and keeps a parking-meter countdown. */
export function FindCarApp() {
  const gps = useSvc('gps');
  const timers = useSvc('timers');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const now = useNow(1000).getTime();
  const { busy, run } = useAction();
  if (!gps) return null;

  const parked = gps.parked;
  const here = gps.fix && gps.latitude !== null && gps.longitude !== null ? { lat: gps.latitude, lon: gps.longitude } : null;
  const nav = parked && here ? bearingAndDistance(here, { lat: parked.latitude, lon: parked.longitude }) : null;
  // With a heading (the car or the phone in hand is moving) the arrow is relative to where you face; without one it points at the compass bearing.
  const facing = gps.heading !== null && (gps.speedKmh ?? 0) > 3 ? gps.heading : null;
  const rotation = nav ? nav.bearing - (facing ?? 0) : 0;
  const meters = timers?.items.filter((t) => t.kind === 'parking') ?? [];

  const act = (action: string, ok: string) => run(() => apiRequest('/api/gps/action', 'POST', { action }), ok);
  const startMeter = (seconds: number) => run(() => apiRequest('/api/timers', 'POST', { seconds, kind: 'parking', label: 'Parking meter' }), 'Meter started');

  return (
    <Page>
      <Cols min={330}>
        <Panel title="Your car" icon={Car}>
          {!parked ? (
            <Empty icon={MapPin} title="No parking spot saved" action={<button type="button" className="btn primary" disabled={!gps.fix || busy} onClick={() => void act('park', 'Parking spot saved')}>Save my parking spot</button>}>
              {gps.fix ? 'Save it when you park, and this page will lead you back to it.' : 'Waiting for a GPS fix. The position is saved from the satellites, so go outside the car park roof first.'}
            </Empty>
          ) : (
            <>
              <div className="fc-compass" aria-label={nav ? `The car is ${shortDistance(nav.km, units)} away, ${compassPoint(nav.bearing)}` : 'Waiting for your position'}>
                <span className="fc-sweep fx" aria-hidden />
                <svg viewBox="0 0 200 200">
                  <circle className="fc-ring" cx="100" cy="100" r="86" />
                  <circle className="fc-ring fc-ring-in" cx="100" cy="100" r="58" />
                  {Array.from({ length: 24 }, (_, i) => (
                    <line key={i} className="fc-tick" x1="100" y1="16" x2="100" y2={i % 6 === 0 ? 26 : 21} transform={`rotate(${i * 15 - (facing ?? 0)} 100 100)`} />
                  ))}
                  <text className="fc-n" x="100" y="30" textAnchor="middle" transform={`rotate(${facing === null ? 0 : -facing} 100 100)`}>
                    N
                  </text>
                  {nav && (
                    <g transform={`rotate(${rotation} 100 100)`}>
                      <path className="fc-arrow" d="M100 40 L124 120 L100 106 L76 120 Z" />
                    </g>
                  )}
                </svg>
                <div className="fc-centre">
                  {nav ? (
                    <>
                      <b>{shortDistance(nav.km, units)}</b>
                      <small>{compassPoint(nav.bearing)}</small>
                    </>
                  ) : (
                    <small>{gps.fix ? '' : 'No fix'}</small>
                  )}
                </div>
              </div>
              <p className="dim small" style={{ textAlign: 'center' }}>
                Parked {Math.max(0, Math.round((now - Date.parse(parked.at)) / 60000))} min ago ({new Date(parked.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}).
                {facing === null && nav ? ' The arrow shows the compass direction; start walking and it will turn to follow you.' : ''}
              </p>
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn" disabled={!gps.fix || busy} onClick={() => void act('park', 'Parking spot updated')}>
                  <Navigation size={16} /> Parked here now
                </button>
                <button type="button" className="btn danger" disabled={busy} onClick={() => void act('clear-park', 'Forgotten')}>
                  <X size={16} /> Forget it
                </button>
              </div>
            </>
          )}
        </Panel>

        <Panel title="Parking meter" icon={Hourglass}>
          {meters.length > 0 ? (
            <div className="list">
              {meters.map((t) => {
                const left = (t.endsAt - now) / 1000;
                return (
                  <div key={t.id} className="tm-row">
                    <Row icon={Hourglass} label="Time left" right={<b className="num tm-left">{countdownText(left)}</b>} />
                    <Meter label="Parking time used" value={Math.max(0, t.durationS - left)} max={t.durationS} tone={left <= 300 ? 'danger' : left <= 900 ? 'warn' : undefined} />
                    <button type="button" className="icon-btn" aria-label="Cancel the parking timer" onClick={() => void run(() => apiRequest(`/api/timers/${t.id}`, 'DELETE'))}>
                      <X />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Banner tone="info" icon={Hourglass}>
              Set how long you have paid for. It rings, wherever you are on the screen, when time is up.
            </Banner>
          )}
          <div className="chips">
            {METER.map((m) => (
              <button key={m.s} type="button" className="chip" disabled={busy} onClick={() => void startMeter(m.s)}>
                {m.label}
              </button>
            ))}
          </div>
        </Panel>
      </Cols>
    </Page>
  );
}
