import { useEffect, useState } from 'react';
import { Globe, PencilLine, Plus, Trash2, Zap } from 'lucide-react';
import { ACTION_ICONS, ACTION_LIMITS, type ActionIcon, type QuickActionDef } from '@headunit/shared';
import { ActionGlyph } from '../components/glyphs';
import { Banner, ConfirmButton, Empty, Page, Panel, Segment, Sheet, TextField, Toggle, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { useTypingLocked } from '../lib/driving';
import { useHeadUnit } from '../store';

interface Config {
  allowInternet: boolean;
  items: QuickActionDef[];
}

/** Buttons that call a web address on the car's own network (a garage door, a Home Assistant webhook, a light). */
export function QuickActionsApp() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [editing, setEditing] = useState<QuickActionDef | 'new' | null>(null);
  const { busy, run } = useAction();
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();

  const load = () => apiRequest<Config>('/api/actions/config').then(setCfg).catch((e: Error) => toast(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cfg) return null;

  const save = (next: Config, ok?: string) => run(async () => setCfg(await apiRequest<Config>('/api/actions/config', 'PUT', next)), ok);
  const open = (a: QuickActionDef | 'new') => (locked ? toast('Editing is locked while driving.') : setEditing(a));
  const test = (a: QuickActionDef) =>
    run(async () => {
      const r = await apiRequest<{ message: string }>(`/api/actions/${a.id}/run`, 'POST');
      toast(`${a.name}: ${r.message}`);
    });

  return (
    <Page
      subtitle="They appear in the Quick Panel. Only devices on this car's own network can be reached, unless you allow the internet below."
      actions={
        <button type="button" className="btn small primary" disabled={cfg.items.length >= ACTION_LIMITS.max} onClick={() => open('new')}>
          <Plus size={16} /> New action
        </button>
      }
    >
      {cfg.items.length === 0 ? (
        <Empty icon={Zap} title="No quick actions">
          Add a button that opens the garage, switches a light, or runs a Home Assistant automation: it just calls a web address.
        </Empty>
      ) : (
        <div className="action-grid stagger">
          {cfg.items.map((a, i) => (
            <div key={a.id} className="action-card" style={{ ['--i' as string]: i }}>
              <button type="button" className="action-main" disabled={busy} onClick={() => void test(a)} aria-label={`Run ${a.name}`}>
                <span className="action-icon">
                  <ActionGlyph icon={a.icon} size={26} />
                </span>
                <b className="truncate">{a.name}</b>
                <small className="truncate">
                  {a.method} {new URL(a.url).host}
                  {a.confirm ? ' · asks first' : ''}
                </small>
              </button>
              <button type="button" className="icon-btn scene-edit" aria-label={`Edit ${a.name}`} onClick={() => open(a)}>
                <PencilLine />
              </button>
            </div>
          ))}
        </div>
      )}

      <Panel title="Reach the internet" icon={Globe}>
        <label className="check-row">
          <Toggle on={cfg.allowInternet} onChange={(v) => void save({ ...cfg, allowInternet: v }, v ? 'Internet addresses allowed' : 'Only the car network')} label="Allow the internet" disabled={busy} />
          <span>Allow addresses on the internet (a cloud webhook)</span>
        </label>
        <Banner tone="info">Off, an action can only reach devices on the same network as this head unit. On, anyone who can tap the button can trigger that web address.</Banner>
      </Panel>

      {editing && (
        <Sheet title={editing === 'new' ? 'New quick action' : 'Edit quick action'} onClose={() => setEditing(null)}>
          <ActionForm
            item={editing === 'new' ? undefined : editing}
            onSave={async (item) => {
              const items = editing === 'new' ? [...cfg.items, item] : cfg.items.map((x) => (x.id === editing.id ? { ...item, id: x.id } : x));
              await save({ ...cfg, items }, 'Saved');
              setEditing(null);
            }}
            onDelete={editing === 'new' ? undefined : async () => {
              await save({ ...cfg, items: cfg.items.filter((x) => x.id !== editing.id) }, 'Deleted');
              setEditing(null);
            }}
          />
        </Sheet>
      )}
    </Page>
  );
}

function ActionForm({ item, onSave, onDelete }: { item?: QuickActionDef; onSave: (a: QuickActionDef) => void | Promise<void>; onDelete?: () => void | Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '');
  const [url, setUrl] = useState(item?.url ?? 'http://');
  const [method, setMethod] = useState<'GET' | 'POST'>(item?.method ?? 'GET');
  const [body, setBody] = useState(item?.body ?? '');
  const [icon, setIcon] = useState<ActionIcon>(item?.icon ?? 'zap');
  const [confirm, setConfirm] = useState(item?.confirm ?? false);
  const valid = name.trim() !== '' && /^https?:\/\/[^/\s]+/.test(url.trim());

  return (
    <>
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={setName} maxLength={24} placeholder="Garage door" />
        <div>
          <label className="lbl">Method</label>
          <Segment<'GET' | 'POST'> label="Method" value={method} onChange={setMethod} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} />
        </div>
        <TextField label="Web address" value={url} onChange={setUrl} maxLength={400} placeholder="http://192.168.1.50/open" className="wide" />
        {method === 'POST' && <TextField label="Body (optional)" value={body} onChange={setBody} maxLength={1000} placeholder='{"state":"on"}' className="wide" />}
        <div className="wide">
          <label className="lbl">Icon</label>
          <div className="chips">
            {ACTION_ICONS.map((i) => (
              <button key={i} type="button" className="chip" data-active={i === icon} aria-label={i} onClick={() => setIcon(i)}>
                <ActionGlyph icon={i} size={18} />
              </button>
            ))}
          </div>
        </div>
        <label className="check-row wide">
          <Toggle on={confirm} onChange={setConfirm} label="Ask first" />
          <span>Ask for a second tap (so a stray touch cannot trigger it)</span>
        </label>
      </div>
      <div className="form-actions">
        {onDelete && <ConfirmButton label="Delete" icon={Trash2} onConfirm={onDelete} />}
        <button type="button" className="btn primary" disabled={!valid} onClick={() => void onSave({ id: item?.id ?? '', name: name.trim(), url: url.trim(), method, body: method === 'POST' ? body : '', icon, confirm })}>
          Save
        </button>
      </div>
    </>
  );
}
