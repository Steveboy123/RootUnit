import { useEffect, useState } from 'react';
import { Compass, Download, Map as MapIcon, Mountain, Satellite } from 'lucide-react';
import type { GpsTrackPoint } from '@headunit/shared';
import { Badge, Banner, Cols, ConfirmButton, Empty, Page, Panel, Stat, Stats, useAction } from '../components/ui';
import { apiRequest, useApi } from '../lib/api';
import { convert, unitLabel } from '../lib/format';
import { altitudeText, fixQuality, secondsSince } from '../lib/gpsInfo';
import { useNow } from '../lib/hooks';
import { projectTrack, scaleBar } from '../lib/trackMap';
import { compassPoint, distUnit, fmt, humanDuration, kmToDisplay, shortDistance } from '../lib/units';
import { useHeadUnit, useSvc } from '../store';

const W = 640;
const H = 380;

/** The breadcrumb of this trip drawn on a plain canvas: no map tiles, so it works with no signal at all. */
function TrackMap({ points, here, parked, units }: { points: readonly GpsTrackPoint[]; here: { lat: number; lon: number } | null; parked: { lat: number; lon: number } | null; units: 'metric' | 'imperial' }) {
  const extra = [...(here ? [here] : []), ...(parked ? [parked] : [])];
  const proj = projectTrack(points, W, H, 36, extra);
  const bar = scaleBar(proj.metresPerPx, 110);
  const first = points[0];
  const me = here ? proj.project(here) : null;
  const car = parked ? proj.project(parked) : null;
  const start = first ? proj.project(first) : null;

  return (
    <svg className="gps-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of this trip: ${points.length} recorded points. North is up.`}>
      <rect className="gps-map-bg" x="0" y="0" width={W} height={H} rx="14" />
      <g className="gps-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={(W / 8) * i} y1="0" x2={(W / 8) * i} y2={H} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={(H / 5) * i} x2={W} y2={(H / 5) * i} />
        ))}
      </g>
      {proj.path && <path className="gps-line-glow" d={proj.path} />}
      {proj.path && <path className="gps-line" d={proj.path} pathLength={1} />}
      {start && <circle className="gps-start" cx={start.x} cy={start.y} r="6" />}
      {car && (
        <g transform={`translate(${car.x} ${car.y})`}>
          <rect className="gps-car" x="-11" y="-11" width="22" height="22" rx="6" />
          <text className="gps-car-p" y="5" textAnchor="middle">
            P
          </text>
        </g>
      )}
      {me && (
        <>
          <circle className="gps-me-halo fx" cx={me.x} cy={me.y} r="14" style={{ transformOrigin: `${me.x}px ${me.y}px` }} />
          <circle className="gps-me" cx={me.x} cy={me.y} r="7" />
        </>
      )}
      <g transform={`translate(${W - 34} 36)`} aria-hidden="true">
        <path className="gps-north" d="M0 -18 L8 6 L0 0 L-8 6 Z" />
        <text className="gps-north-n" y="24" textAnchor="middle">
          N
        </text>
      </g>
      {bar && (
        <g transform={`translate(24 ${H - 26})`}>
          <path className="gps-scale" d={`M0 -5 V0 H${bar.px} V-5`} />
          <text className="gps-scale-t" x="0" y="-10">
            {shortDistance(bar.metres / 1000, units)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Live position and the recorded track of the current trip, from the GPS receiver. */
export function GpsApp() {
  const gps = useSvc('gps');
  const units = useHeadUnit((s) => s.settings?.units ?? 'metric');
  const now = useNow(1000).getTime();
  const { busy, run } = useAction();

  // The track is not part of the live state (it can be 2000 points), so fetch it while this page is open and every few seconds.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);
  const track = useApi<GpsTrackPoint[]>('/api/gps/track.json', tick);

  if (!gps) return null;

  const quality = fixQuality(gps);
  const points = track.data ?? [];
  const here = gps.fix && gps.latitude !== null && gps.longitude !== null ? { lat: gps.latitude, lon: gps.longitude } : null;
  const parked = gps.parked ? { lat: gps.parked.latitude, lon: gps.parked.longitude } : null;
  const age = secondsSince(gps.lastFix, now);
  const tripS = secondsSince(gps.tripStarted, now);
  const metric = units === 'metric';

  return (
    <Page
      subtitle="Position from the satellites, drawn without any map download."
      actions={
        <>
          <a className="btn small" href="/api/gps/track.gpx" download="trip.gpx">
            <Download size={16} /> GPX
          </a>
          <a className="btn small" href="/api/gps/track.csv" download="trip.csv">
            <Download size={16} /> CSV
          </a>
        </>
      }
    >
      {!gps.connected && (
        <Banner tone="danger" icon={Satellite}>
          {gps.detail || 'No GPS receiver found.'} Plug in a USB GPS receiver and make sure gpsd is running.
        </Banner>
      )}
      {gps.connected && !gps.fix && (
        <Banner tone="warn" icon={Satellite}>
          Searching for satellites. A clear view of the sky helps: a fix can take a minute or two after a cold start.
        </Banner>
      )}

      <Cols min={420}>
        <Panel title="This trip" icon={MapIcon} aside={<Badge tone={quality.tone}>{quality.label}</Badge>}>
          {points.length < 2 && !here ? (
            <Empty icon={MapIcon} title="Nothing recorded yet">
              Once the receiver has a fix, your route is drawn here as you drive.
            </Empty>
          ) : (
            <TrackMap points={points} here={here} parked={parked} units={units} />
          )}
          <div className="dim small">
            {points.length} point{points.length === 1 ? '' : 's'} recorded
            {gps.tripStarted ? ` · started ${new Date(gps.tripStarted).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
          <div className="row wrap">
            <ConfirmButton
              label="Start a new trip"
              confirmLabel="Tap again: clears the route and counters"
              onConfirm={() => run(() => apiRequest('/api/gps/action', 'POST', { action: 'reset-trip' }), 'New trip started')}
              className="btn danger"
            />
            {busy && <span className="dim small">Working…</span>}
          </div>
        </Panel>

        <Panel title="Right now" icon={Compass}>
          <Stats cols={2}>
            <Stat label="Speed" value={gps.speedKmh === null ? '–' : Math.round(convert('speed', units, gps.speedKmh))} unit={unitLabel('speed', units)} />
            <Stat label="Heading" value={gps.heading === null || (gps.speedKmh ?? 0) < 2 ? '–' : compassPoint(gps.heading)} hint={gps.heading === null || (gps.speedKmh ?? 0) < 2 ? 'Only known while moving' : `${Math.round(gps.heading)}°`} />
            <Stat label="Altitude" value={altitudeText(gps.altitudeM, metric)} />
            <Stat label="Accuracy" value={gps.accuracyM === null ? '–' : `±${fmt(metric ? gps.accuracyM : gps.accuracyM * 3.28084, 0)}`} unit={metric ? 'm' : 'ft'} />
            <Stat label="Satellites" value={gps.usedSatellites ?? '–'} hint={gps.satellites === null ? undefined : `${gps.satellites} in view`} />
            <Stat label="Last update" value={age === null ? '–' : age < 2 ? 'now' : humanDuration(age)} tone={age !== null && age > 10 ? 'warn' : undefined} hint={age !== null && age > 10 ? 'The receiver has gone quiet' : undefined} />
          </Stats>
        </Panel>

        <Panel title="Trip counters" icon={Mountain}>
          <Stats cols={3}>
            <Stat label="Distance" value={fmt(kmToDisplay(gps.tripKm, units), gps.tripKm < 100 ? 1 : 0)} unit={distUnit(units)} />
            <Stat label="Top speed" value={Math.round(convert('speed', units, gps.topSpeedKmh))} unit={unitLabel('speed', units)} />
            <Stat label="Time" value={tripS === null ? '–' : humanDuration(tripS)} />
          </Stats>
        </Panel>
      </Cols>
    </Page>
  );
}
