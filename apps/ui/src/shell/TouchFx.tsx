import { useEffect, useRef } from 'react';
import { useHeadUnit } from '../store';

const TARGET = 'button, .tap, [role="button"], [role="tab"], [role="switch"]';

/**
 * Press feedback drawn in one fixed layer above everything, so no button needs extra markup: a ripple spreading from the finger, or a
 * glow around the pressed control. The `pop` mode is pure CSS (motion.css). Nothing is drawn at Minimal effects or with Motion off.
 */
export function TouchFx() {
  const mode = useHeadUnit((s) => s.settings?.touchFx ?? 'ripple');
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'ripple' && mode !== 'glow') return;
    const onDown = (e: PointerEvent) => {
      const root = document.documentElement;
      if (root.dataset.calm === 'true' || !e.isPrimary) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(TARGET) : null;
      const host = layer.current;
      if (!target || !host || target.matches(':disabled,[aria-disabled="true"]') || target.closest('.slider,[data-no-fx]')) return;
      const r = target.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      // The app may be scaled (the desktop preview): convert screen pixels to the layer's own.
      const k = box.width > 0 ? host.clientWidth / box.width : 1;
      const el = document.createElement('div');
      el.className = mode === 'ripple' ? 'touch-ripple' : 'touch-glow';
      el.style.left = `${(r.left - box.left) * k}px`;
      el.style.top = `${(r.top - box.top) * k}px`;
      el.style.width = `${r.width * k}px`;
      el.style.height = `${r.height * k}px`;
      el.style.borderRadius = getComputedStyle(target).borderRadius;
      if (mode === 'ripple') {
        const dot = document.createElement('i');
        const d = Math.hypot(r.width, r.height) * 2 * k;
        dot.style.setProperty('--d', `${d}px`);
        dot.style.setProperty('--x', `${(e.clientX - r.left) * k}px`);
        dot.style.setProperty('--y', `${(e.clientY - r.top) * k}px`);
        el.appendChild(dot);
      }
      host.appendChild(el);
      window.setTimeout(() => el.remove(), 640);
    };
    window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => window.removeEventListener('pointerdown', onDown, { capture: true });
  }, [mode]);
  return <div className="touch-layer" ref={layer} aria-hidden="true" />;
}
