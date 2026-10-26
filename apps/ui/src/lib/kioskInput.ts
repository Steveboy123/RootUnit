/**
 * Raspberry Pi OS can expose a touchscreen as mouse events when labwc mouse
 * emulation is enabled. The installer disables that mode, but this drag-scroll
 * fallback keeps the UI usable even before the compositor reloads or on unusual
 * USB touch controllers that still arrive as a mouse pointer.
 */
export function installKioskDragScroll() {
  if (!new URLSearchParams(location.search).has('kiosk')) return () => {};

  type Drag = {
    pointerId: number;
    el: HTMLElement;
    x: number;
    y: number;
    left: number;
    top: number;
    dragged: boolean;
  };
  let drag: Drag | null = null;
  let suppressClickUntil = 0;

  const scrollable = (node: EventTarget | null): HTMLElement | null => {
    // An SVG icon is an Element but not an HTMLElement: a drag that starts on a button's icon must scroll the list behind it too.
    let el: Element | null = node instanceof Element ? node : null;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
      const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2;
      if (x || y) return el as HTMLElement;
      el = el.parentElement;
    }
    return null;
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('input[type="range"], [data-no-drag-scroll="true"]')) return;
    const el = scrollable(e.target);
    if (!el) return;
    drag = { pointerId: e.pointerId, el, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, dragged: false };
  };

  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.dragged && Math.hypot(dx, dy) < 7) return;
    drag.dragged = true;
    drag.el.scrollLeft = drag.left - dx;
    drag.el.scrollTop = drag.top - dy;
    e.preventDefault();
  };

  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.dragged) suppressClickUntil = performance.now() + 300;
    drag = null;
  };

  const click = (e: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, { capture: true, passive: false });
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('click', click, true);
  return () => {
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    document.removeEventListener('click', click, true);
  };
}
