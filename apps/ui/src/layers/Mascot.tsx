import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_SETTINGS } from '@headunit/shared';
import { isEditLocked } from '../lib/driving';
import { useHeadUnit } from '../store';

export const MASCOT_ASSETS = {
  original: '/mascot/original.webp',
  transparent: '/mascot/transparent.webp',
  armored: '/mascot/armored.webp',
} as const;

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * The mascot, drawn over the background and (by default) behind the widgets. On Home it can be dragged into place in Edit mode;
 * otherwise it never takes a touch, even when placed in front. Its motion and aura are CSS (mascot.css): 2.5D transforms on the
 * transparent artwork, not a 3D model. Everything stops while driving, with Motion off, at Minimal effects and with reduced motion.
 */
export function Mascot({ editing = false, className = '' }: { editing?: boolean; className?: string }) {
  const s = useHeadUnit((st) => st.settings ?? DEFAULT_SETTINGS);
  const patchSettings = useHeadUnit((st) => st.patchSettings);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  if (!s.mascotEnabled) return null;
  const canDrag = editing && !isEditLocked();
  const src = MASCOT_ASSETS[s.mascotVariant] ?? MASCOT_ASSETS.transparent;

  const point = (e: ReactPointerEvent<HTMLDivElement>) => {
    const area = ref.current?.parentElement;
    if (!area) return null;
    const r = area.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) };
  };
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDrag || dragging.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    const p = point(e);
    if (p) setPreview(p);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const p = point(e);
    if (p) setPreview(p);
  };
  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = null;
    const p = point(e);
    setPreview(null);
    if (p && (p.x !== s.mascotX || p.y !== s.mascotY)) patchSettings({ mascotX: p.x, mascotY: p.y });
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    const step = e.shiftKey ? 5 : 1;
    const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    patchSettings({ mascotX: clamp(s.mascotX + delta[0]), mascotY: clamp(s.mascotY + delta[1]) });
  };

  const style = {
    '--mx': `${preview?.x ?? s.mascotX}%`,
    '--my': `${preview?.y ?? s.mascotY}%`,
    '--msize': `${s.mascotSize}%`,
    '--mop': s.mascotOpacity / 100,
    '--mglow': s.mascotGlow / 100,
    '--mask': `url("${src}")`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`layer mascot ${className}`}
      data-motion={s.mascotMotion}
      data-aura={s.mascotAura}
      data-place={s.mascotPlacement}
      data-dragging={preview !== null}
      data-editing={canDrag}
      data-beat={s.mascotBeat}
      data-mirror={s.mascotMirror}
      style={style}
      aria-hidden={!canDrag}
    >
      <div className="mascot-pos">
        <div
          className="mascot-subject"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onKeyDown={nudge}
          role={canDrag ? 'button' : undefined}
          aria-label={canDrag ? 'Drag the mascot to move it' : undefined}
          tabIndex={canDrag ? 0 : -1}
        >
          <div className="mascot-aura fx" aria-hidden="true">
            {s.mascotAura === 'sparks' && Array.from({ length: 10 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
            {s.mascotAura === 'smoke' && Array.from({ length: 5 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
          </div>
          <div className="mascot-motion fx">
            <img src={src} alt="" draggable={false} />
            {/* Effects drawn only over the artwork's own pixels (masked by the same picture). */}
            <i className="mascot-fxlayer" />
            <i className="mascot-ghost a" />
            <i className="mascot-ghost b" />
          </div>
          {canDrag && <span className="mascot-hint">Drag the mascot</span>}
        </div>
      </div>
    </div>
  );
}
