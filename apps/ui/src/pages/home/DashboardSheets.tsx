import { useState } from 'react';
import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import type { DashboardPage, WidgetInstance } from '@headunit/shared';
import { Banner, ConfirmButton, Sheet, TextField } from '../../components/ui';
import { useTypingLocked } from '../../lib/driving';
import { canMovePage, movePage, placeWidget, uid } from '../../lib/layout';
import { useHeadUnit } from '../../store';
import { WIDGETS, widgetDef } from '../../widgets/registry';
import type { WidgetDef } from '../../widgets/types';

const GROUPS: Array<WidgetDef['group']> = ['Driving', 'Music', 'Car', 'Everyday'];

export function AddWidgetSheet({ page, onClose }: { page: DashboardPage; onClose(): void }) {
  const layout = useHeadUnit((s) => s.layout);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const [error, setError] = useState('');

  const add = (type: string) => {
    const def = widgetDef(type)!;
    const rect = placeWidget(page.widgets, def.size, def.min);
    if (!rect) {
      setError('No room on this page — remove or shrink a widget first.');
      return;
    }
    const config = def.config ? Object.fromEntries(def.config.map((f) => [f.key, f.default])) : undefined;
    const widget: WidgetInstance = { id: uid('w'), type, ...rect, ...(config ? { config } : {}) };
    setLayout({ ...layout, pages: layout.pages.map((p) => (p.id === page.id ? { ...p, widgets: [...p.widgets, widget] } : p)) });
    onClose();
  };

  return (
    <Sheet title="Add a widget" onClose={onClose} wide>
      {error && <Banner tone="warn">{error}</Banner>}
      {GROUPS.map((g) => (
        <section key={g} className="col" style={{ gap: 8 }}>
          <div className="section-title">{g}</div>
          <div className="tile-grid stagger" style={{ ['--tile-min' as string]: '190px' }}>
            {WIDGETS.filter((d) => d.group === g).map((d, i) => (
              <button key={d.type} type="button" className="card tile" style={{ ['--i' as string]: i, minHeight: 92 }} onClick={() => add(d.type)}>
                <span className="row" style={{ width: '100%' }}>
                  <span className="tile-icon" style={{ width: 38, height: 38 }}>
                    <d.icon size={20} />
                  </span>
                  <span className="spacer" />
                  <span className="badge num">
                    {d.size.w}×{d.size.h}
                  </span>
                </span>
                <span>
                  <div className="tile-name">{d.name}</div>
                  <div className="tile-sub">{d.description}</div>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  );
}

export function PageSheet({ page, onClose }: { page: DashboardPage; onClose(): void }) {
  const layout = useHeadUnit((s) => s.layout);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const setPage = useHeadUnit((s) => s.setPage);
  const [name, setName] = useState(page.name);
  const canDelete = layout.pages.length > 1;
  const locked = useTypingLocked();

  const save = () => {
    const n = name.trim().slice(0, 16) || page.name;
    setLayout({ ...layout, pages: layout.pages.map((p) => (p.id === page.id ? { ...p, name: n } : p)) });
    onClose();
  };
  const remove = () => {
    const pages = layout.pages.filter((p) => p.id !== page.id);
    setLayout({ ...layout, pages });
    setPage(pages[0]!.id);
    onClose();
  };
  const move = (dir: -1 | 1) => setLayout(movePage(layout, page.id, dir));

  return (
    <Sheet
      title="Page"
      onClose={onClose}
      footer={
        <>
          {canDelete && <ConfirmButton label="Delete page" icon={Trash2} confirmLabel="Tap again to delete" onConfirm={remove} />}
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <TextField label="Name" value={name} maxLength={16} onChange={setName} onEnter={save} />
      {layout.pages.length > 1 && (
        <div className="row wrap" role="group" aria-label={locked ? 'Order of the pages: park to change' : 'Order of the pages'}>
          <button type="button" className="btn" disabled={locked || !canMovePage(layout, page.id, -1)} onClick={() => move(-1)}>
            <ArrowLeft /> Move earlier
          </button>
          <button type="button" className="btn" disabled={locked || !canMovePage(layout, page.id, 1)} onClick={() => move(1)}>
            Move later <ArrowRight />
          </button>
        </div>
      )}
    </Sheet>
  );
}
