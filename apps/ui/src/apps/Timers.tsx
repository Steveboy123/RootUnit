import { useRef, useState } from 'react';
import { Flag, Hourglass, Moon, Play, RotateCcw, Square, Timer, X } from 'lucide-react';
import { RingGauge } from '../components/charts';
import { Cols, Empty, Page, Panel, Row, Segment, Stepper, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { useNow } from '../lib/hooks';
import { countdownText, elapsedMs, isRunning, lapStopwatch, lapTimes, newStopwatch, resetStopwatch, startStopwatch, stopStopwatch, stopwatchText, type Stopwatch } from '../lib/stopwatch';
import { useSvc } from '../store';

const PRESETS = [
  { label: '1 min', s: 60 },
  { label: '5 min', s: 300 },
  { label: '10 min', s: 600 },
  { label: '15 min', s: 900 },
  { label: '30 min', s: 1800 },
  { label: '1 h', s: 3600 },
];

export function TimersApp() {
  const [mode, setMode] = useState<'timers' | 'stopwatch'>('timers');
  return (
    <Page>
      <Segment label="Mode" value={mode} onChange={setMode} options={[{ value: 'timers', label: 'Timers', icon: Hourglass }, { value: 'stopwatch', label: 'Stopwatch', icon: Timer }]} />
      {mode === 'timers' ? <Countdowns /> : <StopwatchPanel />}
    </Page>
  );
}

function Countdowns() {
  const timers = useSvc('timers');
  const now = useNow(250).getTime();
  const { run } = useAction();
  const [h, setH] = useState(0);
  const [m, setM] = useState(10);
  const start = (seconds: number, label?: string) => run(() => apiRequest('/api/timers', 'POST', { seconds, kind: 'timer', ...(label ? { label } : {}) }), 'Timer started');
  const cancel = (id: string) => run(() => apiRequest(`/api/timers/${id}`, 'DELETE'));
  const items = timers?.items ?? [];

  return (
    <Cols min={320}>
      <Panel title="Start a timer" icon={Hourglass}>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.s} type="button" className="chip" onClick={() => void start(p.s)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <Stepper label="Hours" value={h} min={0} max={23} format={(v) => `${v} h`} onChange={setH} />
          <Stepper label="Minutes" value={m} min={0} max={59} format={(v) => `${v} min`} onChange={setM} />
          <button type="button" className="btn primary" disabled={h * 3600 + m * 60 < 5} onClick={() => void start(h * 3600 + m * 60)}>
            <Play size={16} /> Start
          </button>
        </div>
      </Panel>

      <Panel title="Running" icon={Timer}>
        {items.length === 0 ? (
          <Empty icon={Hourglass} title="Nothing running">Timers keep going even if you leave this page, and ring wherever you are.</Empty>
        ) : (
          <div className="tm-rings stagger">
            {items.map((t, i) => {
              const left = (t.endsAt - now) / 1000;
              const tone = left <= 0 ? 'danger' : left < 60 ? 'warn' : undefined;
              return (
                <div key={t.id} className="tm-ring" style={{ ['--i' as string]: i }} data-tone={tone}>
                  <RingGauge value={Math.max(0, left)} max={t.durationS} tone={tone} label={`${t.label}: time left`} size={118}>
                    <b className="num">{countdownText(left)}</b>
                    <small>{t.kind === 'sleep' ? <Moon size={13} /> : null} left</small>
                  </RingGauge>
                  <span className="truncate">{t.label}</span>
                  <button type="button" className="icon-btn" aria-label={`Cancel ${t.label}`} onClick={() => void cancel(t.id)}>
                    <X />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Cols>
  );
}

function StopwatchPanel() {
  const [sw, setSw] = useState<Stopwatch>(newStopwatch);
  const running = isRunning(sw);
  const now = useNow(running ? 50 : 1000).getTime();
  const t = useRef(sw);
  t.current = sw;
  const laps = lapTimes(sw);
  const best = laps.length > 1 ? Math.min(...laps) : null;

  return (
    <Panel title="Stopwatch" icon={Timer}>
      <div className="sw-face">
        <div className="sw-dial" aria-hidden>
          {Array.from({ length: 60 }, (_, i) => (
            <i key={i} data-major={i % 5 === 0} style={{ ['--a' as string]: `${i * 6}deg` }} />
          ))}
          <span className="sw-hand" style={{ transform: `rotate(${((elapsedMs(sw, now) / 1000) % 60) * 6}deg)` }} />
        </div>
        <div className="sw-time num" aria-live="off">
          {stopwatchText(elapsedMs(sw, now))}
        </div>
      </div>
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        {running ? (
          <button type="button" className="btn" onClick={() => setSw((s) => stopStopwatch(s, Date.now()))}>
            <Square size={20} /> Stop
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => setSw((s) => startStopwatch(s, Date.now()))}>
            <Play size={20} /> {sw.baseMs > 0 ? 'Resume' : 'Start'}
          </button>
        )}
        <button type="button" className="btn" disabled={!running} onClick={() => setSw((s) => lapStopwatch(s, Date.now()))}>
          <Flag size={20} /> Lap
        </button>
        <button type="button" className="btn" disabled={running || (sw.baseMs === 0 && sw.laps.length === 0)} onClick={() => setSw(resetStopwatch())}>
          <RotateCcw size={20} /> Reset
        </button>
      </div>
      {laps.length > 0 && (
        <div className="list sw-laps">
          {laps
            .map((l, i) => ({ l, i }))
            .reverse()
            .map(({ l, i }) => (
              <Row key={i} label={`Lap ${i + 1}`} right={stopwatchText(l)} tone={best !== null && l === best ? 'ok' : undefined} />
            ))}
        </div>
      )}
    </Panel>
  );
}
