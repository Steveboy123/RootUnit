import { useEffect, useRef, useState } from 'react';
import { Flag, RotateCcw, ShieldAlert, Trophy } from 'lucide-react';
import { Banner, Cols, Page, Panel, Row, Segment } from '../components/ui';
import { apiRequest } from '../lib/api';
import { bestSpeed } from '../lib/driving';
import { newRun, parseBests, perfMode, perfSeconds, PERF_MODES, recordBest, stepPerf, type PerfBests, type PerfMode, type PerfRun, type PerfSample } from '../lib/perf';
import { useHeadUnit } from '../store';

/**
 * Timers for 0-100 km/h, 0-60 mph, 100-200 km/h and the quarter mile, from the GPS speed (or the car's, without GPS).
 * Meant for a closed road or a track; the page says so and does nothing that needs the driver's attention while moving.
 */
export function PerfApp() {
  const [mode, setMode] = useState<PerfMode>('zero-100');
  const [run, setRun] = useState<PerfRun>(() => newRun('zero-100'));
  const [bests, setBests] = useState<PerfBests>({});
  const [fresh, setFresh] = useState(false);
  const prev = useRef<PerfSample | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const bestsRef = useRef(bests);
  bestsRef.current = bests;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    let live = true;
    apiRequest<unknown>('/api/doc/perf')
      .then((d) => live && setBests(parseBests(d)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // One reading per GPS fix (or per OBD update): the run advances on the data, not on a timer.
  useEffect(() => {
    let lastKey = '';
    return useHeadUnit.subscribe((s) => {
      const best = bestSpeed(s.vehicle, s.svc.gps);
      if (!best) return;
      const stamp = best.source === 'gps' && s.svc.gps?.lastFix ? Date.parse(s.svc.gps.lastFix) : Date.now();
      const key = `${best.source}:${stamp}:${best.kmh}`;
      if (key === lastKey) return;
      lastKey = key;
      const sample: PerfSample = { t: stamp, kmh: best.kmh };
      const before = runRef.current;
      const next = stepPerf(before, sample, prev.current);
      prev.current = sample;
      if (next === before) return;
      setRun(next);
      if (next.state === 'done' && before.state !== 'done') {
        const r = recordBest(bestsRef.current, next, Date.now());
        setFresh(r.improved);
        if (r.improved) {
          setBests(r.bests);
          void apiRequest('/api/doc/perf', 'PUT', r.bests).catch(() => undefined);
        }
      }
    });
  }, []);

  const choose = (m: PerfMode) => {
    setMode(m);
    setRun(newRun(m));
    setFresh(false);
    prev.current = null;
  };
  const again = () => choose(mode);
  const def = perfMode(mode);
  const standing = def.from === 0;

  const status =
    run.state === 'idle' ? (standing ? 'Stop the car to get ready' : `Slow below ${def.from} km/h to get ready`)
    : run.state === 'armed' ? 'Ready. Go when it is safe to'
    : run.state === 'running' ? 'Timing…'
    : run.state === 'done' ? (fresh ? 'New personal best!' : 'Finished')
    : 'Run cancelled';

  return (
    <Page>
      <Banner tone="warn" icon={ShieldAlert}>
        For a closed road or a track only. Obey the law, and never take your eyes off the road: this page needs none of your attention while you drive.
      </Banner>
      <Segment<PerfMode> label="Run" value={mode} onChange={choose} options={PERF_MODES.map((m) => ({ value: m.id, label: m.label }))} />
      <Cols min={320}>
        <Panel title={def.label} icon={Flag}>
          <div className="perf-stage" data-state={run.state}>
            <div className="perf-tree" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <i key={i} style={{ ['--i' as string]: i }} />
              ))}
            </div>
            <div className="perf-time num">
              {perfSeconds(run.state === 'done' || run.state === 'running' ? (run.elapsedMs ?? 0) : 0)}
            </div>
            <div className="perf-status">{status}</div>
            {run.state === 'done' && run.trapKmh !== null && mode === 'quarter' && <div className="perf-sub">Speed at the line: {Math.round(run.trapKmh)} km/h</div>}
            {run.state === 'running' && mode === 'quarter' && <div className="perf-sub">{Math.round(run.distanceM)} m of 402</div>}
            {run.state === 'aborted' && run.reason && <div className="perf-sub">{run.reason}</div>}
          </div>
          {(run.state === 'done' || run.state === 'aborted') && (
            <button type="button" className="btn primary" onClick={again}>
              <RotateCcw size={18} /> Go again
            </button>
          )}
        </Panel>

        <Panel title="Personal bests" icon={Trophy}>
          <div className="list">
            {PERF_MODES.map((m) => {
              const b = bests[m.id];
              return <Row key={m.id} icon={Trophy} active={m.id === mode} label={m.label} hint={b ? new Date(b.at).toLocaleDateString() : 'Not set yet'} right={b ? `${perfSeconds(b.ms)}${b.trapKmh ? ` · ${b.trapKmh} km/h` : ''}` : '—'} />;
            })}
          </div>
          <small className="dim">
            Timed from satellite speed, which is good to a few tenths of a second: a fun number, not a certified one.
          </small>
        </Panel>
      </Cols>
    </Page>
  );
}
