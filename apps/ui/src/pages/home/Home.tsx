import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Settings2, X } from 'lucide-react';
import type { WidgetInstance } from '@headunit/shared';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { fits, gridMetrics, movedBy, rectToPx, resizedBy, swipePage, type Rect } from '../../lib/grid';
import { useElementSize } from '../../lib/hooks';
import { useScale } from '../../shell/DeviceFrame';
import { useHeadUnit } from '../../store';
import { widgetDef } from '../../widgets/registry';

type Drag = { id: string; mode: 'move' | 'resize'; pointerId: number; sx: number; sy: number; dx: number; dy: number };

function ConfigPanel({ instance, onChange, onClose }: { instance: WidgetInstance; onChange(c: Record<string, string>): void; onClose(): void }) {
  const def = widgetDef(instance.type);
  return (
    <div className="w-config" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {def?.config?.map((f) => (
        <div key={f.key} className="col" style={{ gap: 6 }}>
          <span className="eyebrow">{f.label}</span>
          <div className="chips">
            {f.options.map((o) => (
              <button key={o.value} type="button" className="chip" data-active={String(instance.config?.[f.key] ?? f.default) === o.value} onClick={() => onChange({ [f.key]: o.value })}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn small primary" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/**
 * Home: the widget dashboard on a 12 × 6 grid. Swipe sideways to change page. In edit mode every widget can be dragged to an empty
 * spot, resized from its corner, configured or removed; the drop target shows green when it fits and red when it does not.
 */
export function HomePage() {
  const layout = useHeadUnit((s) => s.layout);
  const pageId = useHeadUnit((s) => s.pageId);
  const editing = useHeadUnit((s) => s.editing);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const setPage = useHeadUnit((s) => s.setPage);
  const scale = useScale();
  const [gridRef, size] = useElementSize<HTMLDivElement>();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cfgOpen, setCfgOpen] = useState<string | null>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);

  const pageIndex = Math.max(0, layout.pages.findIndex((p) => p.id === pageId));
  const page = layout.pages[pageIndex] ?? layout.pages[0]!;
  const gap = size.h < 420 ? 8 : 10;
  const m = useMemo(() => gridMetrics(size.w, size.h, gap), [size.w, size.h, gap]);

  const update = (widgets: WidgetInstance[]) => setLayout({ ...layout, pages: layout.pages.map((p) => (p.id === page.id ? { ...p, widgets } : p)) });
  const target = (w: WidgetInstance, d: Drag): Rect => (d.mode === 'move' ? movedBy(w, d.dx, d.dy, m) : resizedBy(w, d.dx, d.dy, m, widgetDef(w.type)?.min ?? { w: 1, h: 1 }));

  const startDrag = (w: WidgetInstance, mode: Drag['mode']) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    setCfgOpen(null);
    setDrag({ id: w.id, mode, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    setDrag({ ...drag, dx: (e.clientX - drag.sx) / scale, dy: (e.clientY - drag.sy) / scale });
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const w = page.widgets.find((x) => x.id === drag.id);
    if (w) {
      const r = target(w, drag);
      const others = page.widgets.filter((x) => x.id !== w.id);
      if (fits(r, others) && (r.x !== w.x || r.y !== w.y || r.w !== w.w || r.h !== w.h)) update(page.widgets.map((x) => (x.id === w.id ? { ...x, ...r } : x)));
    }
    setDrag(null);
  };

  // Swipe sideways on the dashboard (not on a slider or a button) to change page.
  const onGridDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (editing || !e.isPrimary || layout.pages.length < 2) return;
    if (e.target instanceof Element && e.target.closest('[data-no-swipe], .slider, input')) return;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onGridUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dir = swipePage((e.clientX - s.x) / scale, (e.clientY - s.y) / scale);
    const next = layout.pages[pageIndex + dir];
    if (dir !== 0 && next) {
      useHeadUnit.setState({ navDir: dir });
      setPage(next.id);
    }
  };

  const dragging = drag ? page.widgets.find((w) => w.id === drag.id) : undefined;
  const ghost = dragging && drag ? target(dragging, drag) : null;
  const ghostOk = ghost && dragging ? fits(ghost, page.widgets.filter((x) => x.id !== dragging.id)) : false;

  return (
    <div className="page fixed home" data-editing={editing}>
      <div className="home-grid" ref={gridRef} onPointerDown={onGridDown} onPointerUp={onGridUp} onPointerCancel={() => (swipe.current = null)}>
        {size.w > 0 && (
          <div className="home-page stagger" key={page.id} data-dir={useHeadUnit.getState().navDir}>
            {page.widgets.map((w, i) => {
              const def = widgetDef(w.type);
              const live = drag?.id === w.id;
              const box = rectToPx(live && drag?.mode === 'resize' && ghost ? ghost : w, m);
              const style = {
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                ['--i' as string]: i,
                transform: live && drag?.mode === 'move' ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.03)` : undefined,
              };
              return (
                <div key={w.id} className="card widget" data-type={w.type} data-dragging={live || undefined} style={style}>
                  <div className="widget-body">
                    <ErrorBoundary fallback={<div className="w-empty">This widget could not be shown.</div>}>
                      {def ? <def.Component instance={w} /> : <div className="w-empty">Unknown widget “{w.type}”</div>}
                    </ErrorBoundary>
                  </div>
                  {editing && (
                    <>
                      <div className="widget-veil" data-no-drag-scroll="true" onPointerDown={startDrag(w, 'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                      <div className="widget-ctls">
                        {def?.config && (
                          <button type="button" className="widget-ctl" aria-label="Configure widget" onClick={() => setCfgOpen((o) => (o === w.id ? null : w.id))}>
                            <Settings2 />
                          </button>
                        )}
                        <button type="button" className="widget-ctl danger" aria-label="Remove widget" onClick={() => update(page.widgets.filter((x) => x.id !== w.id))}>
                          <X />
                        </button>
                      </div>
                      <button type="button" className="widget-resize" aria-label="Resize widget" onPointerDown={startDrag(w, 'resize')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                        <Maximize2 />
                      </button>
                      {cfgOpen === w.id && <ConfigPanel instance={w} onChange={(c) => update(page.widgets.map((x) => (x.id === w.id ? { ...x, config: { ...x.config, ...c } } : x)))} onClose={() => setCfgOpen(null)} />}
                    </>
                  )}
                </div>
              );
            })}
            {ghost && <div className="widget-ghost" data-ok={ghostOk} style={rectToPx(ghost, m)} />}
            {editing && page.widgets.length === 0 && (
              <div className="home-empty">
                <b>This page is empty</b>
                <span>Tap “Widget” above to add one.</span>
              </div>
            )}
          </div>
        )}
      </div>
      {layout.pages.length > 1 && (
        <div className="home-dots" role="tablist" aria-label="Dashboard pages">
          {layout.pages.map((p, i) => (
            <button key={p.id} type="button" role="tab" aria-selected={i === pageIndex} aria-label={p.name} data-active={i === pageIndex} onClick={() => setPage(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
