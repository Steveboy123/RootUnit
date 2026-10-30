import { Gauge, type Zone } from '../components/Gauge';
import { useBestSpeed } from '../lib/driving';
import { convert, unitLabel } from '../lib/format';
import { niceStep } from '../lib/gauge';
import { metricById, metricLevel, reading, type Metric } from '../lib/metrics';
import { useHeadUnit } from '../store';
import type { WidgetProps } from './types';

const useUnits = () => useHeadUnit((s) => s.settings?.units ?? 'metric');

export function Speedometer() {
  const units = useUnits();
  // The car's own speed, or the GPS's when there is no OBD link: a head unit without an adapter still gets a speedometer.
  const best = useBestSpeed();
  const raw = best?.kmh ?? null;
  const val = raw === null ? 0 : convert('speed', units, raw);
  const max = units === 'metric' ? 240 : 160;
  return (
    <div className="w-gauge">
      <Gauge value={val} min={0} max={max} major={units === 'metric' ? 40 : 20} live={raw !== null} peakHold display={raw === null ? '—' : String(Math.round(val))} unit={unitLabel('speed', units)} label={best?.source === 'gps' ? 'GPS SPEED' : 'SPEED'} />
    </div>
  );
}

export const RPM_ZONES: Zone[] = [
  { from: 6, to: 6.5, level: 'warn' },
  { from: 6.5, to: 8, level: 'danger' },
];

export function Tachometer() {
  const v = useHeadUnit((s) => s.vehicle);
  const live = reading(v, metricById('rpm'));
  const rpm = live ?? 0;
  return (
    <div className="w-gauge">
      <Gauge
        value={rpm / 1000}
        min={0}
        max={8}
        major={1}
        zones={RPM_ZONES}
        live={live !== null}
        peakHold
        shiftAt={6}
        level={live === null ? 'ok' : metricLevel(metricById('rpm'), rpm)}
        display={live === null ? '—' : String(Math.round(rpm / 10) * 10)}
        unit="rpm"
        label="ENGINE ×1000"
      />
    </div>
  );
}

/** Warn/danger bands for a metric, converted to display units. */
export function zonesFor(m: Metric, units: 'metric' | 'imperial'): Zone[] {
  const c = (x: number) => convert(m.kind, units, x);
  const z: Zone[] = [];
  if (m.warnHigh !== undefined) z.push({ from: c(m.warnHigh), to: c(m.dangerHigh ?? m.max), level: 'warn' });
  if (m.dangerHigh !== undefined) z.push({ from: c(m.dangerHigh), to: c(m.max), level: 'danger' });
  if (m.dangerLow !== undefined) z.push({ from: c(m.min), to: c(m.dangerLow), level: 'danger' });
  if (m.warnLow !== undefined) z.push({ from: c(m.dangerLow ?? m.min), to: c(m.warnLow), level: 'warn' });
  return z;
}

/** Any engine metric. Tall cells get a gauge; wide, short ones a labelled bar. */
export function GaugeWidget({ instance }: WidgetProps) {
  const units = useUnits();
  const v = useHeadUnit((s) => s.vehicle);
  const m = metricById(instance.config?.metric);
  const live = reading(v, m);
  const base = live ?? m.min;
  const val = convert(m.kind, units, base);
  const lo = convert(m.kind, units, m.min);
  const hi = convert(m.kind, units, m.max);
  const level = live === null ? 'ok' : metricLevel(m, base);
  const text = live === null ? '—' : val.toFixed(m.decimals);
  const unit = unitLabel(m.kind, units);
  const f = Math.min(1, Math.max(0, (val - lo) / (hi - lo || 1)));
  return (
    <>
      <div className="w-gauge tall-only">
        <Gauge value={val} min={lo} max={hi} major={niceStep(lo, hi, 4)} zones={zonesFor(m, units)} level={level} live={live !== null} display={text} unit={unit} label={m.label.toUpperCase()} />
      </div>
      <div className="w-meter wide-only" data-level={level}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="eyebrow">{m.label}</span>
          <span className="w-meter-value num">
            {text}
            <small>{unit}</small>
          </span>
        </div>
        <div className="w-meter-bar">
          <i style={{ transform: `scaleX(${live === null ? 0 : f})` }} />
        </div>
      </div>
    </>
  );
}
