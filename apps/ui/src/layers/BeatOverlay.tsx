import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DEFAULT_SETTINGS } from '@headunit/shared';
import { BAND_COUNT, QUIET, microphoneIsOn, readMicrophoneMeter, stopMicrophoneMeter, type MeterReading } from '../audio/reactive';
import { accentFromImage } from '../lib/accent';
import { selectBackdropArt, useHeadUnit } from '../store';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const WAVE_POINTS = 32;
const RADIAL_BARS = 28;

/** Fixed per-bar shapes for sources that report only loudness (the Pi meter): an equaliser silhouette that rises and falls with it. */
const SHAPE = Array.from({ length: BAND_COUNT }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + 0.6)) * (1 - i / (BAND_COUNT * 1.6)));

/** `#rrggbb` → [r, g, b] */
const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) || 0, parseInt(hex.slice(3, 5), 16) || 0, parseInt(hex.slice(5, 7), 16) || 0];

/** Cool → hot by loudness, for the Heat colour mode. */
function heat(power: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [70, 120, 255]],
    [0.4, [160, 80, 255]],
    [0.7, [255, 70, 140]],
    [1, [255, 190, 60]],
  ];
  let i = 0;
  while (i < stops.length - 2 && power > stops[i + 1]![0]) i++;
  const [p0, c0] = stops[i]!;
  const [p1, c1] = stops[i + 1]!;
  const t = clamp((power - p0) / (p1 - p0));
  return `rgb(${c0.map((v, k) => Math.round(v + (c1[k]! - v) * t)).join(', ')})`;
}

/**
 * The music-reactive layer: above the background, below every control, never takes a touch. It follows REAL sampled audio only: the
 * Pi's audio meter (/api/audio/meter, an ALSA capture of what is playing) or, after an explicit tap, the microphone. With no signal it
 * stays dark; nothing is ever faked from track changes or a timer. React draws it once; a requestAnimationFrame loop only writes CSS
 * variables, which drive transforms and opacity. Off while driving, at Minimal effects, with Motion off and with reduced motion.
 */
export const BeatOverlay = memo(function BeatOverlay() {
  const mode = useHeadUnit((s) => s.settings?.beatMode ?? DEFAULT_SETTINGS.beatMode);
  const source = useHeadUnit((s) => s.settings?.beatSource ?? DEFAULT_SETTINGS.beatSource);
  const sensitivity = useHeadUnit((s) => s.settings?.beatSensitivity ?? DEFAULT_SETTINGS.beatSensitivity);
  const intensity = useHeadUnit((s) => s.settings?.beatIntensity ?? DEFAULT_SETTINGS.beatIntensity);
  const colorMode = useHeadUnit((s) => s.settings?.beatColorMode ?? DEFAULT_SETTINGS.beatColorMode);
  const custom = useHeadUnit((s) => s.settings?.beatColor ?? DEFAULT_SETTINGS.beatColor);
  const art = useHeadUnit((s) => (s.settings?.beatColorMode === 'album' ? selectBackdropArt(s) : undefined));
  const calm = useHeadUnit((s) => s.settings?.effects === 'minimal' || s.settings?.motionSpeed === 'off');
  const moving = useMovingFlag();
  const node = useRef<HTMLDivElement>(null);
  const [albumColor, setAlbumColor] = useState<string | null>(null);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (colorMode !== 'album' || !art) return setAlbumColor(null);
    let live = true;
    void accentFromImage(art).then((c) => live && setAlbumColor(c));
    return () => {
      live = false;
    };
  }, [art, colorMode]);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const cb = () => setReduced(q.matches);
    q.addEventListener('change', cb);
    return () => q.removeEventListener('change', cb);
  }, []);

  // The microphone is never kept running when the source changes or the overlay is switched off.
  useEffect(() => {
    if (source !== 'microphone' || mode === 'off') stopMicrophoneMeter();
  }, [source, mode]);
  useEffect(() => () => stopMicrophoneMeter(), []);

  const enabled = mode !== 'off' && !moving && !reduced && !calm;
  const dynamicTint = colorMode === 'rainbow' || colorMode === 'heat';

  useEffect(() => {
    const el = node.current;
    if (!el || !enabled) return;
    const root = document.documentElement;
    let alive = true;
    let frame = 0;
    let n = 0;
    let tick = 0;
    let smooth = 0;
    let flash = 0;
    let burst = 0;
    let signal: MeterReading = QUIET;
    const wave = new Array<number>(WAVE_POINTS).fill(0);
    const bars = new Array<number>(BAND_COUNT).fill(0);
    const poll = async () => {
      try {
        const r = await fetch('/api/audio/meter', { cache: 'no-store', signal: AbortSignal.timeout(800) });
        if (r.ok && alive) {
          const d = (await r.json()) as MeterReading;
          if (alive && typeof d.level === 'number' && typeof d.bass === 'number') signal = d;
        }
      } catch {
        signal = QUIET;
      }
    };
    if (source === 'system') {
      void poll();
      tick = window.setInterval(() => !document.hidden && void poll(), 125);
    }
    const render = (t: number) => {
      if (!alive) return;
      const reading = source === 'microphone' ? (microphoneIsOn() ? readMicrophoneMeter() : QUIET) : signal;
      const gain = 0.5 + sensitivity / 45;
      const target = document.hidden ? 0 : clamp((reading.level * 0.5 + reading.bass * 0.75) * gain);
      smooth += (target - smooth) * (target > smooth ? 0.3 : 0.11);
      flash = Math.max(flash * 0.8, reading.beat ? clamp(0.45 + intensity / 145) : 0);
      // 0% intensity really means no light at all.
      const power = clamp(((smooth * 0.9 + flash * 0.35) * intensity) / 100);
      el.style.setProperty('--beat-power', power.toFixed(3));
      el.style.setProperty('--beat-hit', ((flash * intensity) / 100).toFixed(3));
      if (reading.beat && power > 0.05) {
        burst++;
        el.dataset.burst = burst % 2 ? 'a' : 'b';
      }
      n++;
      // Bars: real bands from the microphone, the equaliser silhouette for the Pi meter.
      for (let i = 0; i < BAND_COUNT; i++) {
        const goal = reading.bands ? clamp(reading.bands[i]! * gain * (intensity / 100)) : clamp(power * SHAPE[i]! * (0.8 + 0.4 * Math.sin(t / 260 + i)));
        bars[i]! += (goal - bars[i]!) * (goal > bars[i]! ? 0.45 : 0.15);
        el.style.setProperty(`--b${i}`, Math.max(0.04, bars[i]!).toFixed(3));
      }
      // The loudness trace scrolls left every other frame.
      if (n % 2 === 0) {
        wave.shift();
        wave.push(power);
        for (let i = 0; i < WAVE_POINTS; i++) el.style.setProperty(`--w${i}`, wave[i]!.toFixed(3));
      }
      if (n % 4 === 0) {
        root.style.setProperty('--mascot-beat-power', power.toFixed(3));
        if (colorMode === 'rainbow') el.style.setProperty('--beat-tint', `hsl(${Math.round((t / 40) % 360)} 95% 62%)`);
        else if (colorMode === 'heat') el.style.setProperty('--beat-tint', heat(power));
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (tick) window.clearInterval(tick);
      el.style.setProperty('--beat-power', '0');
      el.style.setProperty('--beat-hit', '0');
      root.style.setProperty('--mascot-beat-power', '0');
    };
  }, [enabled, mode, source, sensitivity, intensity, colorMode]);

  if (!enabled) return null;
  const tint = colorMode === 'custom' ? custom : colorMode === 'album' ? (albumColor ?? 'var(--accent)') : 'var(--accent)';
  const [r, g, b] = rgbOf(colorMode === 'custom' ? custom : albumColor ?? '#000000');
  const style = { '--beat-tint': dynamicTint ? undefined : tint, ...(colorMode === 'custom' || (colorMode === 'album' && albumColor) ? { '--beat-rgb': `${r}, ${g}, ${b}` } : {}) } as CSSProperties;

  return (
    <div ref={node} className="layer beat" data-mode={mode} aria-hidden="true" style={style}>
      {(mode === 'glow' || mode === 'wash') && <i className="beat-light" />}
      {mode === 'halo' && <i className="beat-halo" />}
      {mode === 'edges' && (
        <>
          <i className="beat-edge t" />
          <i className="beat-edge b" />
          <i className="beat-edge l" />
          <i className="beat-edge r" />
        </>
      )}
      {mode === 'rings' && (
        <div className="beat-rings">
          <i />
          <i />
          <i />
        </div>
      )}
      {mode === 'spectrum' && (
        <div className="beat-bars">
          {Array.from({ length: BAND_COUNT }, (_, i) => (
            <i key={i} style={{ ['--v' as string]: `var(--b${i})` }} />
          ))}
        </div>
      )}
      {mode === 'radial' && (
        <div className="beat-radial">
          {Array.from({ length: RADIAL_BARS }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${(i / RADIAL_BARS) * 360}deg`, ['--v' as string]: `var(--b${i % BAND_COUNT})` }} />
          ))}
        </div>
      )}
      {mode === 'wave' && (
        <div className="beat-wave">
          {Array.from({ length: WAVE_POINTS }, (_, i) => (
            <i key={i} style={{ ['--v' as string]: `var(--w${i})` }} />
          ))}
        </div>
      )}
      {mode === 'burst' && (
        <div className="beat-burst">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${(i / 14) * 360}deg` }} />
          ))}
        </div>
      )}
    </div>
  );
});

/** True while the car moves (above 8 km/h, from OBD or GPS). A single boolean, so the overlay does not redraw with the speed. */
function useMovingFlag(): boolean {
  return useHeadUnit((s) => {
    const v = s.vehicle?.connected && !s.vehicle.unsupported?.includes('speedKmh') ? s.vehicle.speedKmh : null;
    const g = s.svc.gps?.fix ? s.svc.gps.speedKmh : null;
    return (v ?? g ?? 0) > 8;
  });
}
