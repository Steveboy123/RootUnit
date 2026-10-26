import { useState, type ReactNode } from 'react';
import { PencilLine, Play, Plus, Trash2, WandSparkles } from 'lucide-react';
import { SCENE_ICONS, SCENE_TARGETS, THEME_IDS, type Scene, type SceneActions, type SceneIcon, type SceneTarget, type ThemeId } from '@headunit/shared';
import { SceneGlyph } from '../components/glyphs';
import { ConfirmButton, Empty, Page, Segment, Sheet, Stepper, TextField, Toggle, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { useTypingLocked } from '../lib/driving';
import { applyScene, sceneSummary } from '../lib/scenes';
import { paletteOf } from '../lib/themes';
import { useHeadUnit, useSvc } from '../store';

const TARGET_LABEL: Record<SceneTarget, string> = { home: 'Home', drive: 'Drive', media: 'Music', aa: 'Android Auto', apps: 'Apps' };
const LIGHT_COLOURS = ['#2a4bff', '#30a5ff', '#22c55e', '#facc15', '#fb923c', '#ef4444', '#d946ef', '#ffffff'];

/** What a scene does, in a sentence. */
export function describeScene(a: SceneActions): string {
  const parts: string[] = [];
  if (a.theme) parts.push(`${paletteOf(a.theme).label} look`);
  if (a.brightness !== undefined) parts.push(`brightness ${a.brightness}`);
  if (a.volume !== undefined) parts.push(`volume ${a.volume}`);
  if (a.lights) parts.push(a.lights.enabled ? 'lights on' : 'lights off');
  if (a.go) parts.push(`opens ${TARGET_LABEL[a.go]}`);
  if (a.standby) parts.push('standby clock');
  return parts.join(' · ') || 'Does nothing yet';
}

export function ScenesApp() {
  const scenes = useSvc('scenes');
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  const [editing, setEditing] = useState<Scene | 'new' | null>(null);
  if (!scenes) return null;
  const open = (s: Scene | 'new') => (locked ? toast('Editing is locked while driving.') : setEditing(s));

  return (
    <Page
      subtitle="One tap sets the look, brightness, volume and lights together. They are also in the Quick Panel."
      actions={
        <button type="button" className="btn small primary" onClick={() => open('new')}>
          <Plus size={16} /> New scene
        </button>
      }
    >
      {scenes.length === 0 ? (
        <Empty icon={WandSparkles} title="No scenes">
          Make one for night driving, a long trip, or parking up for the evening.
        </Empty>
      ) : (
        <div className="scene-grid stagger">
          {scenes.map((s, i) => {
            const pal = s.actions.theme ? paletteOf(s.actions.theme) : null;
            const p = pal?.preview ?? null;
            return (
              <div key={s.id} className="scene-card" style={{ ['--i' as string]: i, ...(p ? { ['--s1' as string]: p[0], ['--s2' as string]: p[1], ['--s3' as string]: p[2] } : {}) }} data-themed={p !== null} data-ink={pal?.scheme === 'light' ? 'dark' : undefined}>
                <button type="button" className="scene-main" onClick={async () => toast(sceneSummary(s, await applyScene(s)))} aria-label={`Apply ${s.name}`}>
                  <span className="scene-glyph">
                    <SceneGlyph icon={s.icon} size={26} />
                  </span>
                  <b className="truncate">{s.name}</b>
                  <small>{describeScene(s.actions)}</small>
                  <span className="scene-go">
                    <Play size={16} /> Apply
                  </span>
                </button>
                <button type="button" className="icon-btn scene-edit" aria-label={`Edit ${s.name}`} onClick={() => open(s)}>
                  <PencilLine />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <Sheet title={editing === 'new' ? 'New scene' : 'Edit scene'} onClose={() => setEditing(null)}>
          <SceneForm scene={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}
    </Page>
  );
}

/** A switch that, when on, reveals the control it enables: a scene only touches what it names. */
function Part({ label, on, onChange, children }: { label: string; on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="part" data-on={on}>
      <label className="check-row">
        <Toggle on={on} onChange={onChange} label={label} />
        <span>{label}</span>
      </label>
      {on && <div className="part-body">{children}</div>}
    </div>
  );
}

function SceneForm({ scene, onDone }: { scene?: Scene; onDone: () => void }) {
  const { busy, run } = useAction();
  const a0 = scene?.actions ?? {};
  const [name, setName] = useState(scene?.name ?? '');
  const [icon, setIcon] = useState<SceneIcon>(scene?.icon ?? 'star');
  const [theme, setTheme] = useState<ThemeId | null>(a0.theme ?? null);
  const [brightness, setBrightness] = useState<number | null>(a0.brightness ?? null);
  const [volume, setVolume] = useState<number | null>(a0.volume ?? null);
  const [lights, setLights] = useState<{ enabled: boolean; color: string } | null>(a0.lights ? { enabled: a0.lights.enabled, color: a0.lights.color ?? '#30a5ff' } : null);
  const [go, setGo] = useState<SceneTarget | null>(a0.go ?? null);
  const [standby, setStandby] = useState(a0.standby === true);

  const save = async () => {
    const actions: SceneActions = {
      ...(theme ? { theme } : {}),
      ...(brightness !== null ? { brightness } : {}),
      ...(volume !== null ? { volume } : {}),
      ...(lights ? { lights: lights.enabled ? { enabled: true, color: lights.color } : { enabled: false } } : {}),
      ...(go ? { go } : {}),
      ...(standby ? { standby: true } : {}),
    };
    const body = { name, icon, actions };
    const ok = await run(() => (scene ? apiRequest(`/api/scenes/${scene.id}`, 'PUT', body) : apiRequest('/api/scenes', 'POST', body)), 'Scene saved');
    if (ok) onDone();
  };
  const remove = () => run(() => apiRequest(`/api/scenes/${scene!.id}`, 'DELETE'), 'Scene deleted').then((ok) => ok && onDone());

  return (
    <>
      <TextField label="Name" value={name} onChange={setName} maxLength={24} placeholder="Night drive" />
      <div className="chips">
        {SCENE_ICONS.map((i) => (
          <button key={i} type="button" className="chip" data-active={i === icon} aria-label={i} onClick={() => setIcon(i)}>
            <SceneGlyph icon={i} size={18} />
          </button>
        ))}
      </div>

      <Part label="Change the look" on={theme !== null} onChange={(v) => setTheme(v ? 'midnight' : null)}>
        <div className="chips scroll">
          {THEME_IDS.map((id) => (
            <button key={id} type="button" className="chip" data-active={theme === id} onClick={() => setTheme(id)}>
              <span className="swatch" style={{ background: `linear-gradient(135deg, ${paletteOf(id).preview[0]}, ${paletteOf(id).preview[1]})` }} />
              {paletteOf(id).label}
            </button>
          ))}
        </div>
      </Part>
      <Part label="Screen brightness" on={brightness !== null} onChange={(v) => setBrightness(v ? 60 : null)}>
        <Stepper label="Brightness" value={brightness ?? 60} min={5} max={100} step={5} format={(v) => `${v}%`} onChange={setBrightness} />
      </Part>
      <Part label="Volume" on={volume !== null} onChange={(v) => setVolume(v ? 50 : null)}>
        <Stepper label="Volume" value={volume ?? 50} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={setVolume} />
      </Part>
      <Part label="Cabin lights" on={lights !== null} onChange={(v) => setLights(v ? { enabled: true, color: '#30a5ff' } : null)}>
        <Segment<'on' | 'off'> label="Lights" value={lights?.enabled ? 'on' : 'off'} onChange={(v) => setLights({ enabled: v === 'on', color: lights?.color ?? '#30a5ff' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        {lights?.enabled && (
          <div className="swatch-row">
            {LIGHT_COLOURS.map((c) => (
              <button key={c} type="button" className="swatch-btn" aria-label={c} data-active={lights.color === c} style={{ background: c }} onClick={() => setLights({ enabled: true, color: c })} />
            ))}
          </div>
        )}
      </Part>
      <Part label="Go to a screen" on={go !== null} onChange={(v) => setGo(v ? 'drive' : null)}>
        <div className="chips">
          {SCENE_TARGETS.map((t) => (
            <button key={t} type="button" className="chip" data-active={go === t} onClick={() => setGo(t)}>
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>
      </Part>
      <Part label="Show the standby clock" on={standby} onChange={setStandby}>
        <small className="dim">The screen shows a quiet clock until touched.</small>
      </Part>

      <div className="form-actions">
        {scene && <ConfirmButton label="Delete" icon={Trash2} onConfirm={remove} />}
        <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
    </>
  );
}
