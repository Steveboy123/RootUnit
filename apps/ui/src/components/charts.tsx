import { useMemo, useState, type ReactNode } from 'react';
import { barPath, compact, linePath, nearestIndex, niceMax, xPositions, yScale } from '../lib/chart';
import { useElementSize } from '../lib/hooks';
import type { Tone } from './ui';

/**
 * Small charts that follow one specification: thin marks (bars at most 24 px, rounded only at the data end), 2 px lines with a
 * ringed end dot, hairline grid, text in text colours (the data colour only ever fills marks), and only the extremes labelled.
 * A touchscreen has no hover, so tapping a mark reads its exact value in the line above the chart.
 */

const AXIS_LEFT = 34;
const AXIS_BOTTOM = 22;
const TOP = 8;

export interface BarDatum {
  /** Shown on the axis, short: "Mon", "19". */
  label: string;
  /** Spoken and shown in the readout: "Wednesday 19 June". */
  title: string;
  value: number;
}

export function BarChart({ data, unit, format = (v) => compact(v), height = 150, emphasise = data.length - 1 }: { data: BarDatum[]; unit: string; format?: (v: number) => string; height?: number; emphasise?: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? emphasise;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const w = Math.max(0, size.w);
  const plotW = Math.max(0, w - AXIS_LEFT - 4);
  const base = height - AXIS_BOTTOM;
  const slot = data.length ? plotW / data.length : 0;
  const bw = Math.min(24, Math.max(3, slot - 4)); // never wider than 24, and always at least a 4 px gap between neighbours
  const y = (v: number) => base - (v / max) * (base - TOP);
  const labelEvery = slot >= 34 ? 1 : slot >= 18 ? 2 : 3;
  const tall = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const chosen = data[sel];

  return (
    <figure className="ch" aria-label={`Bar chart, ${unit}`}>
      <figcaption className="ch-readout" aria-live="polite">
        {chosen ? (
          <>
            <span>{chosen.title}</span>
            <b>
              {format(chosen.value)} <small>{unit}</small>
            </b>
          </>
        ) : (
          <span>No data yet</span>
        )}
      </figcaption>
      <div ref={ref} className="ch-plot" style={{ height }}>
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={data.map((d) => `${d.title}: ${format(d.value)} ${unit}`).join('. ')}>
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line className="ch-grid" x1={AXIS_LEFT} x2={w} y1={y(t)} y2={y(t)} />
                <text className="ch-tick" x={AXIS_LEFT - 6} y={y(t) + 4} textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = AXIS_LEFT + slot * i + slot / 2;
              const x = cx - bw / 2;
              return (
                <g key={i} className="ch-bar" data-on={i === sel} onPointerDown={() => setPicked(i)}>
                  {/* A wide invisible target: the visible bar is thin, a finger is not. */}
                  <rect x={AXIS_LEFT + slot * i} y={0} width={slot} height={height} fill="transparent" />
                  <path d={barPath(x, bw, y(d.value), base)} />
                  {i % labelEvery === 0 && (
                    <text className="ch-tick" x={cx} y={height - 6} textAnchor="middle">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Label the tallest bar only: a number on every bar is noise. */}
            {data[tall] && data[tall].value > 0 && sel !== tall && (
              <text className="ch-value" x={AXIS_LEFT + slot * tall + slot / 2} y={y(data[tall].value) - 5} textAnchor="middle">
                {format(data[tall].value)}
              </text>
            )}
          </svg>
        )}
      </div>
    </figure>
  );
}

export interface LinePoint {
  label: string;
  title: string;
  /** Null leaves a gap. */
  value: number | null;
}

export function LineChart({ points, unit, format = (v) => String(Math.round(v * 10) / 10), height = 150 }: { points: LinePoint[]; unit: string; format?: (v: number) => string; height?: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [picked, setPicked] = useState<number | null>(null);
  const w = Math.max(0, size.w);
  const base = height - AXIS_BOTTOM;
  const xs = useMemo(() => xPositions(points.length, AXIS_LEFT + 10, Math.max(AXIS_LEFT + 10, w - 14)), [points.length, w]);
  const values = points.map((p) => p.value);
  const real = values.filter((v): v is number => v !== null);
  const scale = yScale(real, TOP + 6, base - 4);
  const ys = values.map((v) => (v === null ? null : scale.y(v)));
  const lastIdx = values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
  const sel = picked ?? lastIdx;
  const chosen = points[sel];
  const lo = real.length ? Math.min(...real) : null;
  const hi = real.length ? Math.max(...real) : null;
  const loIdx = lo === null ? -1 : values.indexOf(lo);
  const hiIdx = hi === null ? -1 : values.indexOf(hi);
  const line = linePath(xs, ys);
  const area = ys.every((v) => v !== null) && xs.length > 1 ? `${line}L${xs.at(-1)},${base}L${xs[0]},${base}Z` : '';
  const ticks = real.length ? [lo!, hi!].filter((v, i, a) => a.indexOf(v) === i) : [];

  return (
    <figure className="ch" aria-label={`Line chart, ${unit}`}>
      <figcaption className="ch-readout" aria-live="polite">
        {chosen && chosen.value !== null ? (
          <>
            <span>{chosen.title}</span>
            <b>
              {format(chosen.value)} <small>{unit}</small>
            </b>
          </>
        ) : (
          <span>Not enough data yet</span>
        )}
      </figcaption>
      <div
        ref={ref}
        className="ch-plot"
        style={{ height }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = r.width > 0 ? w / r.width : 1;
          if (xs.length) setPicked(nearestIndex(xs, (e.clientX - r.left) * k));
        }}
      >
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={points.filter((p) => p.value !== null).map((p) => `${p.title}: ${format(p.value!)} ${unit}`).join('. ')}>
            <line className="ch-grid" x1={AXIS_LEFT} x2={w} y1={base} y2={base} />
            {ticks.map((t) => (
              <g key={t}>
                <line className="ch-grid" x1={AXIS_LEFT} x2={w} y1={scale.y(t)} y2={scale.y(t)} />
                <text className="ch-tick" x={AXIS_LEFT - 6} y={scale.y(t) + 4} textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ))}
            {area && <path className="ch-area" d={area} />}
            <path className="ch-line" d={line} />
            {/* Dots are only drawn where they carry meaning: the ends and the point being read. */}
            {[...new Set([lastIdx, sel, loIdx, hiIdx])]
              .filter((i) => i >= 0 && ys[i] !== null)
              .map((i) => (
                <circle key={i} className="ch-dot" data-on={i === sel} cx={xs[i]} cy={ys[i]!} r={i === sel ? 5 : 4} />
              ))}
            {points.length > 0 && (
              <>
                <text className="ch-tick" x={xs[0]} y={height - 6} textAnchor="start">
                  {points[0]!.label}
                </text>
                <text className="ch-tick" x={xs.at(-1)} y={height - 6} textAnchor="end">
                  {points.at(-1)!.label}
                </text>
              </>
            )}
          </svg>
        )}
      </div>
    </figure>
  );
}

/** A line with no axes, for a widget: the trend and where it ends. */
export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const w = Math.max(0, size.w);
  const xs = xPositions(values.length, 6, Math.max(6, w - 6));
  const scale = yScale(values, 6, height - 6);
  return (
    <div ref={ref} className="ch-spark" style={{ height }} aria-hidden>
      {w > 0 && values.length > 1 && (
        <svg width={w} height={height}>
          <path className="ch-line" d={linePath(xs, values.map(scale.y))} />
          <circle className="ch-dot" cx={xs.at(-1)} cy={scale.y(values.at(-1)!)} r={4} />
        </svg>
      )}
    </div>
  );
}

/** A 270 degree ring: the fill is the value, its colour says how worried to be (accent, then warning, then danger). */
export function RingGauge({ value, max, tone, children, label, size = 96 }: { value: number | null; max: number; tone?: Tone; children?: ReactNode; label: string; size?: number }) {
  const r = 40;
  const sweep = 0.75;
  const len = 2 * Math.PI * r;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className="ch-ring" data-tone={tone} style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemax={max}>
      <svg viewBox="0 0 100 100">
        <circle className="ch-ring-track" cx="50" cy="50" r={r} strokeDasharray={`${len * sweep} ${len}`} transform="rotate(135 50 50)" />
        {frac > 0 && <circle className="ch-ring-fill" cx="50" cy="50" r={r} strokeDasharray={`${len * sweep * frac} ${len}`} transform="rotate(135 50 50)" />}
      </svg>
      <div className="ch-ring-text">{children}</div>
    </div>
  );
}
