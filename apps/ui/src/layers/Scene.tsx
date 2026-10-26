import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { DashScene } from '@headunit/shared';
import { useHeadUnit } from '../store';

/**
 * The animated scene behind Home, the music pages, Now Playing and Drive. Every scene is a handful of plain elements whose
 * `transform` and `opacity` are animated by CSS (scenes.css): no canvas, no WebGL, no filters. How many elements a scene draws follows
 * Settings → Effects → Scene intensity. The whole layer is left out while the car moves, at Minimal effects, with Motion off and when
 * the system asks for reduced motion (App decides; see `sceneAllowed`).
 */

/** Mulberry32: deterministic, so a scene looks the same each time it mounts. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many elements a scene draws at intensity `k` (0.1..1): never fewer than 3, so a scene is still recognisable. */
export const countFor = (base: number, k: number) => Math.max(3, Math.round(base * Math.min(1, Math.max(0.1, k))));

type V = CSSProperties & Record<`--${string}`, string | number>;

/** `n` elements with randomised custom properties. */
function scatter(n: number, seed: number, make: (r: () => number, i: number) => V, className = ''): ReactNode[] {
  const r = seeded(seed);
  return Array.from({ length: n }, (_, i) => <i key={i} className={className || undefined} style={make(r, i)} />);
}

const MATRIX_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF<>/*+=';

function sceneBody(scene: DashScene, k: number): ReactNode {
  switch (scene) {
    case 'glow':
      return (
        <>
          <i className="sc-glow a" />
          <i className="sc-glow b" />
        </>
      );
    case 'orbits':
      return (
        <div className="sc-orbits">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sc-orbit" style={{ ['--i' as string]: i }}>
              <i />
            </div>
          ))}
          <b className="sc-core" />
        </div>
      );
    case 'grid':
      return (
        <>
          <i className="sc-horizon" />
          <div className="sc-floor">
            <i />
          </div>
        </>
      );
    case 'particles':
      return scatter(countFor(46, k), 11, (r) => ({ '--x': `${r() * 100}%`, '--s': `${2 + r() * 4}px`, '--d': `${14 + r() * 22}s`, '--delay': `${-r() * 30}s`, '--o': 0.3 + r() * 0.6, '--dx': `${(r() - 0.5) * 80}px` }), 'sc-mote');
    case 'warp':
      return <div className="sc-warp">{scatter(countFor(70, k), 21, (r) => ({ '--a': `${r() * 360}deg`, '--d': `${1.2 + r() * 2.4}s`, '--delay': `${-r() * 4}s`, '--l': `${40 + r() * 140}px` }))}</div>;
    case 'waves':
      return (
        <>
          <i className="sc-wave a" />
          <i className="sc-wave b" />
          <i className="sc-wave c" />
        </>
      );
    case 'rain':
      return scatter(countFor(90, k), 31, (r) => ({ '--x': `${r() * 110 - 5}%`, '--d': `${0.55 + r() * 0.5}s`, '--delay': `${-r() * 2}s`, '--l': `${30 + r() * 50}px`, '--o': 0.25 + r() * 0.45 }), 'sc-drop');
    case 'fireflies':
      return scatter(countFor(28, k), 41, (r) => ({ '--x': `${r() * 100}%`, '--y': `${20 + r() * 75}%`, '--d': `${9 + r() * 12}s`, '--delay': `${-r() * 20}s`, '--b': `${1.6 + r() * 2.6}s`, '--mx': `${(r() - 0.5) * 140}px`, '--my': `${(r() - 0.5) * 90}px` }), 'sc-fly');
    case 'matrix': {
      const r = seeded(51);
      const cols = countFor(34, k);
      return (
        <div className="sc-matrix">
          {Array.from({ length: cols }, (_, i) => {
            const len = 10 + Math.floor(r() * 18);
            const text = Array.from({ length: len }, () => MATRIX_GLYPHS[Math.floor(r() * MATRIX_GLYPHS.length)]).join('\n');
            return (
              <span key={i} style={{ ['--x' as string]: `${(i / cols) * 100 + r() * 2}%`, ['--d' as string]: `${6 + r() * 9}s`, ['--delay' as string]: `${-r() * 15}s`, ['--o' as string]: 0.35 + r() * 0.55, ['--fs' as string]: `${12 + Math.floor(r() * 8)}px` }}>
                {text}
              </span>
            );
          })}
        </div>
      );
    }
    case 'nebula':
      return (
        <div className="sc-nebula">
          <i className="n1" />
          <i className="n2" />
          <i className="n3" />
          {scatter(countFor(24, k), 61, (r) => ({ '--x': `${r() * 100}%`, '--y': `${r() * 100}%`, '--b': `${2 + r() * 4}s`, '--delay': `${-r() * 6}s` }), 'sc-twinkle')}
        </div>
      );
    case 'snow':
      return scatter(countFor(60, k), 71, (r) => ({ '--x': `${r() * 100}%`, '--s': `${2 + r() * 5}px`, '--d': `${9 + r() * 12}s`, '--delay': `${-r() * 20}s`, '--sw': `${10 + r() * 30}px`, '--o': 0.4 + r() * 0.5 }), 'sc-flake');
    case 'lava':
      return scatter(countFor(7, k), 81, (r, i) => ({ '--x': `${8 + (i / 7) * 84 + (r() - 0.5) * 8}%`, '--s': `${16 + r() * 18}vmin`, '--d': `${18 + r() * 16}s`, '--delay': `${-r() * 30}s`, '--c': i % 2 ? 'var(--accent-2)' : 'var(--accent)' }), 'sc-lava');
    case 'rings':
      return <div className="sc-rings">{scatter(5, 91, (_r, i) => ({ '--delay': `${-i * 1.6}s` }))}</div>;
    case 'comets':
      return scatter(countFor(6, k), 101, (r) => ({ '--y': `${r() * 60}%`, '--x': `${20 + r() * 80}%`, '--d': `${7 + r() * 9}s`, '--delay': `${-r() * 14}s`, '--l': `${120 + r() * 160}px` }), 'sc-comet');
    case 'bubbles':
      return scatter(countFor(26, k), 111, (r) => ({ '--x': `${r() * 100}%`, '--s': `${10 + r() * 34}px`, '--d': `${10 + r() * 14}s`, '--delay': `${-r() * 24}s`, '--sw': `${8 + r() * 26}px` }), 'sc-bubble');
    case 'tunnel':
      return <div className="sc-tunnel">{scatter(8, 121, (_r, i) => ({ '--delay': `${-i * 0.5}s` }))}</div>;
    case 'synthsun':
      return (
        <>
          <div className="sc-sun">
            <i />
          </div>
          <div className="sc-floor">
            <i />
          </div>
        </>
      );
    case 'circuit':
      return scatter(countFor(16, k), 131, (r, i) => ({ '--p': `${8 + r() * 84}%`, '--d': `${3 + r() * 5}s`, '--delay': `${-r() * 8}s`, '--w': `${60 + r() * 120}px`, '--c': i % 3 === 0 ? 'var(--accent-2)' : 'var(--accent)' }), 'sc-pulse');
    default:
      return null;
  }
}

export const Scene = memo(function Scene({ scene, className = '' }: { scene: DashScene; className?: string }) {
  const k = useHeadUnit((s) => (s.settings?.sceneIntensity ?? 60) / 100);
  const body = useMemo(() => sceneBody(scene, k), [scene, k]);
  if (scene === 'off' || !body) return null;
  return (
    <div className={`layer scene fx ${className}`} data-scene={scene} aria-hidden="true">
      {body}
    </div>
  );
});

/** The weather drawn over the scene when Weather effects is on: what it is doing outside right now. */
export type WeatherFx = 'rain' | 'snow' | 'fog' | 'stars' | null;

/** WMO weather code (Open-Meteo) → what to draw. Clear nights get stars; nothing is drawn for plain cloud or a sunny day. */
export function weatherFxFor(code: number | undefined, isDay: boolean | undefined): WeatherFx {
  if (code === undefined) return null;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 45 || code === 48) return 'fog';
  if (code <= 1 && isDay === false) return 'stars';
  return null;
}

export const WeatherLayer = memo(function WeatherLayer({ fx }: { fx: WeatherFx }) {
  const k = useHeadUnit((s) => (s.settings?.sceneIntensity ?? 60) / 100);
  const body = useMemo(() => {
    if (fx === 'rain') return sceneBody('rain', Math.min(1, k + 0.2));
    if (fx === 'snow') return sceneBody('snow', k);
    if (fx === 'fog')
      return (
        <>
          <i className="sc-fog a" />
          <i className="sc-fog b" />
        </>
      );
    if (fx === 'stars') return scatter(countFor(40, k), 141, (r) => ({ '--x': `${r() * 100}%`, '--y': `${r() * 70}%`, '--b': `${2 + r() * 4}s`, '--delay': `${-r() * 6}s` }), 'sc-twinkle');
    return null;
  }, [fx, k]);
  if (!body) return null;
  return (
    <div className="layer scene weather fx" data-scene={fx === 'stars' ? 'nebula' : fx === 'fog' ? 'fog' : fx ?? undefined} aria-hidden="true">
      {body}
    </div>
  );
});
