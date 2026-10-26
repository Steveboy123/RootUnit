import { useEffect, useRef, useState } from 'react';
import type { GaugeStyle } from '@headunit/shared';
import { arcPath, polar, SWEEP, SWEEP_START, ticks, valueToDeg } from '../lib/gauge';
import type { Level } from '../lib/metrics';
import { useHeadUnit } from '../store';

export interface Zone {
  from: number;
  to: number;
  level: Exclude<Level, 'ok'>;
}

export interface GaugeProps {
  value: number;
  min: number;
  max: number;
  /** Major tick spacing, in display units. */
  major: number;
  tickLabel?: (v: number) => string;
  zones?: Zone[];
  level?: Level;
  /** The big number (already formatted; "—" when there is no live reading). */
  display: string;
  unit?: string;
  label?: string;
  /** No live reading: the value is drawn as empty, never as a guess. */
  live?: boolean;
  /** Show a small mark at the highest value of the last minute. */
  peakHold?: boolean;
  /** Glow the whole gauge from this value up (a tachometer's shift light). */
  shiftAt?: number;
  /** Override the setting (previews). */
  styleOverride?: GaugeStyle;
}

const CX = 100;
const CY = 100;
const R = 78;
const PEAK_MS = 60_000;

/** The highest value seen in the last minute (for the peak-hold mark). */
function usePeak(value: number, live: boolean, enabled: boolean): number | null {
  const [peak, setPeak] = useState<{ v: number; at: number } | null>(null);
  const ref = useRef(peak);
  ref.current = peak;
  useEffect(() => {
    if (!enabled || !live) return;
    const p = ref.current;
    const now = Date.now();
    if (!p || value >= p.v || now - p.at > PEAK_MS) setPeak({ v: value, at: now });
  }, [value, live, enabled]);
  return enabled && peak && Date.now() - peak.at <= PEAK_MS ? peak.v : null;
}

const frac = (v: number, min: number, max: number) => Math.min(1, Math.max(0, (v - min) / (max - min || 1)));

/**
 * A responsive SVG gauge in the style chosen in Settings → Type & gauges: arc, needle, digital, ring, bar, sport, led or hud.
 * Every style shows the same thing (the number, the unit, the warning zones); only the drawing changes.
 */
export function Gauge(props: GaugeProps) {
  const chosen = useHeadUnit((s) => s.settings?.gaugeStyle ?? 'arc');
  const style = props.styleOverride ?? chosen;
  const { value, min, max, level = 'ok', display, unit, label, live = true, peakHold = false, shiftAt } = props;
  const peak = usePeak(value, live, peakHold);
  const shift = live && shiftAt !== undefined && value >= shiftAt;
  const f = live ? frac(value, min, max) : 0;
  const common = { 'data-level': level, 'data-shift': shift || undefined, role: 'img', 'aria-label': `${label ?? ''} ${display} ${unit ?? ''}`.trim() } as const;

  if (style === 'digital' || style === 'bar') {
    const SEG = style === 'digital' ? 24 : 32;
    const lit = Math.round(f * SEG);
    const zoneAt = (i: number): Level => {
      const v = min + ((i + 0.5) / SEG) * (max - min);
      return props.zones?.find((z) => v >= z.from && v <= z.to)?.level ?? 'ok';
    };
    return (
      <svg className={`gauge g-${style}`} viewBox="0 0 200 130" {...common}>
        <text className="g-number" x={100} y={style === 'digital' ? 62 : 56} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={style === 'digital' ? 100 : 100} y={style === 'digital' ? 96 : 88} textAnchor="middle">
            {unit}
          </text>
        )}
        {Array.from({ length: SEG }, (_, i) => {
          const w = 180 / SEG;
          const h = style === 'bar' ? 10 : 6 + (i / SEG) * 10;
          return <rect key={i} className="g-seg" data-on={i < lit} data-zone={zoneAt(i)} x={10 + i * w + 0.8} y={style === 'bar' ? 104 : 122 - h} width={w - 1.6} height={h} rx={1.2} />;
        })}
        {label && style === 'bar' && (
          <text className="g-label" x={100} y={18} textAnchor="middle">
            {label}
          </text>
        )}
      </svg>
    );
  }

  if (style === 'led') {
    // A race dash: a row of shift lights (green, then amber, then red, like the real thing) over a big number on an LCD panel.
    const N = 15;
    const lit = Math.round(f * N);
    return (
      <svg className="gauge g-ledbar" viewBox="0 0 200 130" {...common}>
        {Array.from({ length: N }, (_, i) => {
          const v = min + ((i + 0.5) / N) * (max - min);
          const zone = props.zones?.find((z) => v >= z.from && v <= z.to)?.level ?? (i >= N - 3 ? 'danger' : i >= N - 6 ? 'warn' : 'ok');
          return <circle key={i} className="g-shift" data-on={i < lit} data-zone={zone} cx={16 + i * 12} cy={14} r={4.6} />;
        })}
        <rect className="g-lcd" x={14} y={30} width={172} height={74} rx={8} />
        <text className="g-number" x={100} y={66} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={100} y={120} textAnchor="middle">
            {unit}
          </text>
        )}
        {peak !== null && <rect className="g-peak" x={14 + frac(peak, min, max) * 168} y={106} width={4} height={4} rx={1} />}
      </svg>
    );
  }

  if (style === 'hud') {
    // A sci-fi readout: a ring of fine ticks that light up to the value, a thin inner arc, corner brackets round the number.
    const N = 56;
    const lit = Math.round(f * N);
    const inner = arcPath(CX, CY, R - 14, SWEEP_START, SWEEP_START + SWEEP);
    return (
      <svg className="gauge g-hud" viewBox="0 0 200 200" {...common}>
        {Array.from({ length: N }, (_, i) => {
          const a = SWEEP_START + ((i + 0.5) / N) * SWEEP;
          const v = min + ((i + 0.5) / N) * (max - min);
          const zone = props.zones?.find((z) => v >= z.from && v <= z.to)?.level ?? 'ok';
          const [x1, y1] = polar(CX, CY, R - 4, a);
          const [x2, y2] = polar(CX, CY, R + (i % 7 === 0 ? 10 : 5), a);
          return <line key={i} className="g-hud-tick" data-on={i < lit} data-zone={zone} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        <path className="g-hud-track" d={inner} pathLength={100} />
        {f > 0.002 && <path className="g-hud-value" d={inner} pathLength={100} strokeDasharray={`${f * 100} 100`} />}
        {peak !== null && <circle className="g-peak" cx={polar(CX, CY, R - 14, valueToDeg(peak, min, max))[0]} cy={polar(CX, CY, R - 14, valueToDeg(peak, min, max))[1]} r={3.5} />}
        <path className="g-bracket" d="M58 78 v-10 h10 M142 78 v-10 h-10 M58 120 v10 h10 M142 120 v10 h-10" />
        <text className="g-number" x={CX} y={CY} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={CX} y={CY + 42} textAnchor="middle">
            {unit}
          </text>
        )}
        {label && (
          <text className="g-label" x={CX} y={CY + 72} textAnchor="middle">
            {label}
          </text>
        )}
      </svg>
    );
  }

  if (style === 'ring') {
    const r = 74;
    const c = 2 * Math.PI * r;
    return (
      <svg className="gauge g-ring" viewBox="0 0 200 200" {...common}>
        <circle className="g-track" cx={CX} cy={CY} r={r} />
        {f > 0.002 && <circle className="g-value" cx={CX} cy={CY} r={r} strokeDasharray={`${f * c} ${c}`} transform={`rotate(-90 ${CX} ${CY})`} />}
        {peak !== null && <circle className="g-peak" cx={polar(CX, CY, r, -90 + frac(peak, min, max) * 360)[0]} cy={polar(CX, CY, r, -90 + frac(peak, min, max) * 360)[1]} r={4} />}
        <text className="g-number" x={CX} y={CY - 2} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={CX} y={CY + 34} textAnchor="middle">
            {unit}
          </text>
        )}
        {label && (
          <text className="g-label" x={CX} y={CY - 40} textAnchor="middle">
            {label}
          </text>
        )}
      </svg>
    );
  }

  const track = arcPath(CX, CY, R, SWEEP_START, SWEEP_START + SWEEP);
  const majors = ticks(min, max, props.major);
  const minors = ticks(min, max, props.major / 2).filter((t) => !majors.includes(t));
  const peakDeg = peak !== null ? valueToDeg(peak, min, max) : null;

  if (style === 'needle') {
    const deg = valueToDeg(live ? value : min, min, max);
    return (
      <svg className="gauge g-needle" viewBox="0 0 200 200" {...common}>
        <circle className="g-dial" cx={CX} cy={CY} r={94} />
        {props.zones?.map((z) => <path key={`${z.from}-${z.to}`} className={`g-zone g-zone-${z.level}`} d={arcPath(CX, CY, R + 4, valueToDeg(z.from, min, max), valueToDeg(z.to, min, max))} />)}
        {minors.map((t) => {
          const a = valueToDeg(t, min, max);
          const [x1, y1] = polar(CX, CY, R + 6, a);
          const [x2, y2] = polar(CX, CY, R, a);
          return <line key={`m${t}`} className="g-tick minor" x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
        {majors.map((t) => {
          const a = valueToDeg(t, min, max);
          const [x1, y1] = polar(CX, CY, R + 8, a);
          const [x2, y2] = polar(CX, CY, R - 4, a);
          const [lx, ly] = polar(CX, CY, R - 18, a);
          return (
            <g key={t}>
              <line className="g-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
              <text className="g-tick-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
                {props.tickLabel ? props.tickLabel(t) : t}
              </text>
            </g>
          );
        })}
        {peakDeg !== null && <line className="g-peak-line" x1={polar(CX, CY, R + 9, peakDeg)[0]} y1={polar(CX, CY, R + 9, peakDeg)[1]} x2={polar(CX, CY, R - 6, peakDeg)[0]} y2={polar(CX, CY, R - 6, peakDeg)[1]} />}
        <text className="g-number small" x={CX} y={CY + 44} textAnchor="middle" dominantBaseline="central">
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={CX} y={CY + 64} textAnchor="middle">
            {unit}
          </text>
        )}
        <g className="g-pointer" style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
          <path d={`M ${CX - 6} ${CY + 3} L ${CX + R - 4} ${CY} L ${CX - 6} ${CY - 3} Z`} />
        </g>
        <circle className="g-hub" cx={CX} cy={CY} r={8} />
      </svg>
    );
  }

  if (style === 'sport') {
    const N = 42;
    const lit = Math.round(f * N);
    return (
      <svg className="gauge g-sport" viewBox="0 0 200 200" {...common}>
        {Array.from({ length: N }, (_, i) => {
          const a0 = SWEEP_START + (i / N) * SWEEP + 1;
          const a1 = SWEEP_START + ((i + 1) / N) * SWEEP - 1;
          const v = min + ((i + 0.5) / N) * (max - min);
          const zone = props.zones?.find((z) => v >= z.from && v <= z.to)?.level ?? 'ok';
          return <path key={i} className="g-led" data-on={i < lit} data-zone={zone} d={arcPath(CX, CY, R, a0, a1)} />;
        })}
        {majors.map((t) => {
          const [lx, ly] = polar(CX, CY, R - 22, valueToDeg(t, min, max));
          return (
            <text key={t} className="g-tick-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
              {props.tickLabel ? props.tickLabel(t) : t}
            </text>
          );
        })}
        {peakDeg !== null && <circle className="g-peak" cx={polar(CX, CY, R + 12, peakDeg)[0]} cy={polar(CX, CY, R + 12, peakDeg)[1]} r={3.5} />}
        <text className="g-number" x={CX} y={CY + 4} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
          {display}
        </text>
        {unit && (
          <text className="g-unit" x={CX} y={CY + 36} textAnchor="middle">
            {unit}
          </text>
        )}
        {label && (
          <text className="g-label" x={CX} y={CY + 72} textAnchor="middle">
            {label}
          </text>
        )}
      </svg>
    );
  }

  // arc (the default)
  return (
    <svg className="gauge g-arc" viewBox="0 0 200 200" {...common}>
      <defs>
        <linearGradient id="g-arc-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <path className="g-track" d={track} pathLength={100} />
      {props.zones?.map((z) => <path key={`${z.from}-${z.to}`} className={`g-zone g-zone-${z.level}`} d={arcPath(CX, CY, R + 14, valueToDeg(z.from, min, max), valueToDeg(z.to, min, max))} />)}
      {f > 0.002 && (
        <>
          <path className="g-glow" d={track} pathLength={100} strokeDasharray={`${f * 100} 100`} />
          <path className="g-value" d={track} pathLength={100} strokeDasharray={`${f * 100} 100`} />
        </>
      )}
      {minors.map((t) => {
        const a = valueToDeg(t, min, max);
        const [x1, y1] = polar(CX, CY, R - 11, a);
        const [x2, y2] = polar(CX, CY, R - 14, a);
        return <line key={`m${t}`} className="g-tick minor" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {majors.map((t) => {
        const a = valueToDeg(t, min, max);
        const [x1, y1] = polar(CX, CY, R - 11, a);
        const [x2, y2] = polar(CX, CY, R - 17, a);
        const [lx, ly] = polar(CX, CY, R - 27, a);
        return (
          <g key={t}>
            <line className="g-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
            <text className="g-tick-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
              {props.tickLabel ? props.tickLabel(t) : t}
            </text>
          </g>
        );
      })}
      {peakDeg !== null && <circle className="g-peak" cx={polar(CX, CY, R, peakDeg)[0]} cy={polar(CX, CY, R, peakDeg)[1]} r={4} />}
      <text className="g-number" x={CX} y={CY + 6} textAnchor="middle" dominantBaseline="central" data-long={display.length >= 4}>
        {display}
      </text>
      {unit && (
        <text className="g-unit" x={CX} y={CY + 36} textAnchor="middle">
          {unit}
        </text>
      )}
      {label && (
        <text className="g-label" x={CX} y={CY + 72} textAnchor="middle">
          {label}
        </text>
      )}
    </svg>
  );
}
