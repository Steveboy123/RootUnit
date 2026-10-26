import { useState } from 'react';
import { CheckSquare, ListChecks, NotebookPen, PencilLine, Pin, Plus, Square, Trash2, X } from 'lucide-react';
import type { ChecklistItem, Note } from '@headunit/shared';
import { ConfirmButton, Empty, Meter, Page, Segment, Sheet, TextField, Toggle, useAction } from '../components/ui';
import { apiRequest, useApi } from '../lib/api';
import { useTypingLocked } from '../lib/driving';
import { useHeadUnit } from '../store';

const TEMPLATES: Array<{ label: string; title: string; kind: 'note' | 'list'; items: string[] }> = [
  { label: 'Note', title: '', kind: 'note', items: [] },
  { label: 'Checklist', title: '', kind: 'list', items: [] },
  { label: 'Road trip', title: 'Road trip', kind: 'list', items: ['Documents and licence', 'Phone charger and cable', 'Water and snacks', 'First-aid kit', 'Spare tyre and jack', 'Torch', 'Sunglasses', 'Paper map (just in case)'] },
  { label: 'Shopping', title: 'Shopping', kind: 'list', items: [] },
];

type Draft = { id?: string; title: string; kind: 'note' | 'list'; text: string; items: ChecklistItem[]; pinned: boolean };

const toDraft = (n: Note): Draft => ({ id: n.id, title: n.title, kind: n.kind, text: n.text, items: n.items, pinned: n.pinned });

export function NotesApp() {
  const { data: notes, reload } = useApi<Note[]>('/api/notes');
  const [draft, setDraft] = useState<Draft | null>(null);
  const locked = useTypingLocked();
  const toast = useHeadUnit((s) => s.showToast);
  const { run } = useAction();

  const edit = (d: Draft) => (locked ? toast('Editing is locked while driving.') : setDraft(d));
  // Ticking an item is one touch, so it is allowed while driving: a passenger-free "did I pack it?" check.
  const tick = (n: Note, item: ChecklistItem) =>
    run(async () => {
      await apiRequest(`/api/notes/${n.id}`, 'PUT', { ...n, items: n.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) });
      reload();
    });

  return (
    <Page
      subtitle="Notes and checklists, kept on the head unit"
      actions={
        <div className="chips">
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" className="chip" onClick={() => edit({ title: t.title, kind: t.kind, text: '', items: t.items.map((text, i) => ({ id: `new${i}`, text, done: false })), pinned: false })}>
              <Plus size={14} /> {t.label}
            </button>
          ))}
        </div>
      }
    >
      {notes && notes.length === 0 && (
        <Empty icon={NotebookPen} title="No notes yet">
          Keep a packing list for the next trip, what to buy on the way home, or an idea for the car. Pick a template above.
        </Empty>
      )}
      <div className="note-grid stagger">
        {(notes ?? []).map((n, idx) => {
          const done = n.items.filter((i) => i.done).length;
          return (
            <section key={n.id} className="card note-card" data-kind={n.kind} style={{ ['--i' as string]: idx, ['--tilt' as string]: `${((idx % 3) - 1) * 0.6}deg` }}>
              <header className="note-head">
                {n.kind === 'list' ? <ListChecks size={18} /> : <NotebookPen size={18} />}
                <b className="grow truncate">{n.title || (n.kind === 'list' ? 'Checklist' : 'Note')}</b>
                {n.pinned && <Pin size={15} className="accent-text" />}
                <button type="button" className="icon-btn" aria-label={`Edit ${n.title || 'note'}`} onClick={() => edit(toDraft(n))}>
                  <PencilLine />
                </button>
              </header>
              {n.kind === 'list' ? (
                <>
                  <div className="note-items">
                    {n.items.slice(0, 7).map((i) => (
                      <button key={i.id} type="button" className="note-item" data-done={i.done} onClick={() => void tick(n, i)}>
                        {i.done ? <CheckSquare size={20} /> : <Square size={20} />}
                        <span>{i.text}</span>
                      </button>
                    ))}
                    {n.items.length > 7 && <small className="dim">+{n.items.length - 7} more</small>}
                  </div>
                  <Meter label="Done" value={done} max={Math.max(1, n.items.length)} tone={n.items.length > 0 && done === n.items.length ? 'ok' : undefined} />
                  <small className="dim">
                    {done} of {n.items.length} done
                  </small>
                </>
              ) : (
                <p className="note-text">{n.text}</p>
              )}
            </section>
          );
        })}
      </div>

      {draft && (
        <Sheet title={draft.id ? 'Edit' : 'New'} onClose={() => setDraft(null)}>
          <Editor
            draft={draft}
            onSaved={() => {
              setDraft(null);
              reload();
            }}
          />
        </Sheet>
      )}
    </Page>
  );
}

function Editor({ draft: initial, onSaved }: { draft: Draft; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [adding, setAdding] = useState('');
  const { busy, run } = useAction();

  const addItem = () => {
    const text = adding.trim();
    if (!text) return;
    setD((x) => ({ ...x, items: [...x.items, { id: `new${Date.now()}`, text, done: false }] }));
    setAdding('');
  };
  const body = () => ({ title: d.title, kind: d.kind, text: d.text, pinned: d.pinned, items: d.items.map((i) => ({ id: i.id.startsWith('new') ? '' : i.id, text: i.text, done: i.done })) });
  const save = async () => {
    const ok = await run(() => (d.id ? apiRequest(`/api/notes/${d.id}`, 'PUT', body()) : apiRequest('/api/notes', 'POST', body())), 'Saved');
    if (ok) onSaved();
  };
  const remove = async () => {
    if (await run(() => apiRequest(`/api/notes/${d.id}`, 'DELETE'), 'Deleted')) onSaved();
  };

  return (
    <>
      <div className="form-grid">
        <TextField label="Title" value={d.title} onChange={(title) => setD({ ...d, title })} maxLength={60} className="wide" />
        <div className="wide">
          <Segment<'note' | 'list'> label="Kind" value={d.kind} onChange={(kind) => setD({ ...d, kind })} options={[{ value: 'note', label: 'Note' }, { value: 'list', label: 'Checklist' }]} />
        </div>
        {d.kind === 'note' ? (
          <label className="wide">
            <span className="lbl">Text</span>
            <textarea className="note-area" value={d.text} maxLength={4000} rows={6} onChange={(e) => setD({ ...d, text: e.target.value })} />
          </label>
        ) : (
          <div className="wide">
            <div className="list">
              {d.items.map((i) => (
                <div key={i.id} className="row note-edit-row">
                  <button type="button" className="icon-btn" aria-label={i.done ? 'Mark not done' : 'Mark done'} onClick={() => setD({ ...d, items: d.items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)) })}>
                    {i.done ? <CheckSquare /> : <Square />}
                  </button>
                  <span className="grow" data-done={i.done}>{i.text}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${i.text}`} onClick={() => setD({ ...d, items: d.items.filter((x) => x.id !== i.id) })}>
                    <X />
                  </button>
                </div>
              ))}
            </div>
            <form
              className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                addItem();
              }}
            >
              <TextField label="Add an item" value={adding} onChange={setAdding} maxLength={160} className="grow" />
              <button className="btn" type="submit" disabled={!adding.trim()}>
                <Plus size={16} /> Add
              </button>
            </form>
          </div>
        )}
        <label className="check-row wide">
          <Toggle on={d.pinned} onChange={(pinned) => setD({ ...d, pinned })} label="Pin to the top" />
          <span>Pin to the top</span>
        </label>
      </div>
      <div className="form-actions">
        {d.id && <ConfirmButton label="Delete" icon={Trash2} onConfirm={remove} />}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}
