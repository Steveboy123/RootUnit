import { useMemo, useState, type ReactNode } from 'react';
import { Bluetooth, Camera, Car, Eye, House, LayoutGrid, Lightbulb, Moon, PencilLine, Settings, Smartphone, Sun, SunMedium, Sunrise, Users, Volume2, VolumeX, Zap, type LucideIcon } from 'lucide-react';
import { sanitizePanel, type ActionIcon, type QuickTile, type SceneIcon } from '@headunit/shared';
import { ACTION_GLYPHS, SceneGlyph } from '../components/glyphs';
import { Segment, Slider, useAction } from '../components/ui';
import { apiRequest } from '../lib/api';
import { displayModeOf, displayModePatch, type DisplayMode } from '../lib/displayMode';
import { useTypingLocked } from '../lib/driving';
import { formatDuration } from '../lib/format';
import { useNow } from '../lib/hooks';
import { openNavEditor } from '../lib/nav';
import { useArmed } from '../lib/nav/armed';
import { applyScene, sceneSummary } from '../lib/scenes';
import { QUICK_TILE_LABELS } from '../lib/surfaces';
import { useHeadUnit, useSvc } from '../store';

const SLEEP_CHOICES = [
  { value: 'off', label: 'Off' },
  { value: '900', label: '15 min' },
  { value: '1800', label: '30 min' },
  { value: '3600', label: '1 h' },
  { value: '5400', label: '90 min' },
];

/** The picture on each tile (Settings draws the same ones next to its names). */
export const QUICK_TILE_ICONS: Readonly<Record<QuickTile, LucideIcon>> = {
  camera: Camera,
  standby: Eye,
  passenger: Users,
  lights: Lightbulb,
  aa: Car,
  phones: Smartphone,
  bt: Bluetooth,
};

/**
 * Pulled down from the status bar, over whatever is on screen: volume, brightness, day or night, the things a driver reaches for,
 * scenes, quick actions and the sleep timer. While closed nothing here is subscribed to anything.
 */
export function QuickPanel() {
  const open = useHeadUnit((s) => s.quickPanel);
  return open ? <QuickPanelBody /> : null;
}

function SleepLeft({ endsAt }: { endsAt: number }) {
  const now = useNow(1000).getTime();
  return <span className="dim"> · music stops in {formatDuration((endsAt - now) / 1000)}</span>;
}

/**
 * A tall slider you drag up and down, like the controls on a phone: the fill rises from the bottom (a transform), the value is under
 * it. The arrow keys move it by 5. Changes are sent while dragging; the number shown follows the finger.
 */
function TallSlider({ icon, label, value, min = 0, onChange, onIcon }: { icon: ReactNode; label: string; value: number; min?: number; onChange: (v: number) => void; onIcon?: () => void }) {
  const [live, setLive] = useState<number | null>(null);
  const shown = live ?? value;
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.round(Math.min(100, Math.max(min, ((r.bottom - e.clientY) / Math.max(1, r.height)) * 100)));
  };
  const set = (v: number) => {
    setLive(v);
    onChange(v);
  };
  return (
    <div className="qp-tall">
      <div
        className="qp-tall-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={100}
        aria-valuenow={shown}
        data-no-swipe
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(at(e));
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(at(e))}
        onPointerUp={() => setLive(null)}
        onPointerCancel={() => setLive(null)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 5 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -5 : 0;
          if (!step) return;
          e.preventDefault();
          onChange(Math.min(100, Math.max(min, value + step)));
        }}
      >
        <i style={{ transform: `scaleY(${shown / 100})` }} />
        <b className="num">{shown}</b>
      </div>
      {onIcon ? (
        <button type="button" className="qp-tall-icon" aria-label={label === 'Volume' && shown === 0 ? 'Unmute' : `Mute`} onClick={onIcon}>
          {icon}
        </button>
      ) : (
        <span className="qp-tall-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <small>{label}</small>
    </div>
  );
}

export function QuickPanelBody() {
  const setOpen = useHeadUnit((s) => s.setQuickPanel);
  const system = useHeadUnit((s) => s.system);
  const patchSystem = useHeadUnit((s) => s.patchSystem);
  const settings = useHeadUnit((s) => s.settings);
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const passenger = useHeadUnit((s) => s.passenger);
  const setPassenger = useHeadUnit((s) => s.setPassenger);
  const cameraCmd = useHeadUnit((s) => s.camera_cmd);
  const setStandby = useHeadUnit((s) => s.setStandby);
  const projection = useHeadUnit((s) => s.projection);
  const projectionCmd = useHeadUnit((s) => s.projection_cmd);
  const go = useHeadUnit((s) => s.go);
  const toast = useHeadUnit((s) => s.showToast);
  const scenes = useSvc('scenes');
  const actions = useSvc('actions');
  const lighting = useSvc('lighting');
  const timers = useSvc('timers');
  const locked = useTypingLocked();
  const { run } = useAction();
  const stored = settings?.panel;
  const panel = useMemo(() => sanitizePanel(stored), [stored]);

  if (!system || !settings) return null;

  const sleep = timers?.items.find((t) => t.kind === 'sleep');
  const sleepValue = sleep ? (SLEEP_CHOICES.find((c) => c.value !== 'off' && Number(c.value) === sleep.durationS)?.value ?? 'custom') : 'off';
  const muted = system.muted || system.volume === 0;
  const mode = displayModeOf(settings);

  const setSleep = (v: string) =>
    run(async () => {
      if (sleep) await apiRequest(`/api/timers/${sleep.id}`, 'DELETE');
      if (v !== 'off') await apiRequest('/api/timers', 'POST', { seconds: Number(v), kind: 'sleep', label: 'Sleep timer' });
    }, v === 'off' ? 'Sleep timer off' : 'Music will stop by itself');

  const tile = (key: QuickTile, on: boolean | undefined, onClick: () => void, sub?: string) => {
    const Icon = QUICK_TILE_ICONS[key];
    return (
      <button key={key} type="button" className="qp-tile" data-on={on} onClick={onClick}>
        <Icon />
        <span>
          {QUICK_TILE_LABELS[key]}
          {sub && <small>{sub}</small>}
        </span>
      </button>
    );
  };

  const tileFor = (id: QuickTile): ReactNode => {
    switch (id) {
      case 'camera':
        return tile(id, undefined, () => (setOpen(false), cameraCmd('show')));
      case 'standby':
        return tile(id, undefined, () => setStandby(true));
      case 'passenger':
        return tile(id, passenger, () => setPassenger(!passenger), passenger ? 'On' : 'Off');
      case 'lights':
        return lighting?.configured ? tile(id, lighting.enabled, () => void run(() => apiRequest('/api/lighting/update', 'POST', { enabled: !lighting.enabled })), lighting.enabled ? 'On' : 'Off') : null;
      case 'aa':
        return projection && projection.status !== 'unavailable'
          ? tile(id, projection.status === 'active', () => (setOpen(false), projection.status === 'active' ? projectionCmd('stop') : go('aa')))
          : null;
      case 'phones':
        return tile(id, undefined, () => go('devices'));
      case 'bt':
        return tile(id, undefined, () => go('settings'));
      default:
        return null;
    }
  };
  const tiles = panel.tiles.map(tileFor).filter((t) => t !== null);

  return (
    <>
      <div className="qp-scrim" onClick={() => setOpen(false)} data-no-swipe data-no-edge-back />
      <div className="qp" role="dialog" aria-label="Quick controls" data-no-edge-back data-no-swipe>
        <div className="qp-top">
          <TallSlider icon={muted ? <VolumeX /> : <Volume2 />} label="Volume" value={system.muted ? 0 : system.volume} onChange={(v) => patchSystem({ volume: v, muted: false })} onIcon={() => patchSystem({ muted: !system.muted })} />
          <TallSlider icon={<SunMedium />} label="Brightness" min={5} value={system.brightness} onChange={(v) => patchSystem({ brightness: v })} />
          <div className="qp-side">
            <Segment<Exclude<DisplayMode, 'custom'>>
              label="Display"
              value={mode === 'custom' ? ('' as 'auto') : mode}
              onChange={(m) => patchSettings(displayModePatch(m, settings))}
              options={[
                { value: 'auto', label: 'Auto', icon: Sunrise },
                { value: 'day', label: 'Day', icon: Sun },
                { value: 'night', label: 'Night', icon: Moon },
              ]}
            />
            {tiles.length > 0 && <div className="qp-tiles stagger">{tiles}</div>}
          </div>
        </div>

        {panel.sections.scenes && scenes && scenes.length > 0 && (
          <section className="col" style={{ gap: 8 }}>
            <div className="section-title">Scenes</div>
            <div className="chips">
              {scenes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  onClick={async () => {
                    setOpen(false);
                    toast(sceneSummary(s, await applyScene(s)));
                  }}
                >
                  <SceneGlyph icon={s.icon as SceneIcon} size={16} />
                  {s.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {panel.sections.actions && actions && actions.length > 0 && (
          <section className="col" style={{ gap: 8 }}>
            <div className="section-title">Quick actions</div>
            <div className="chips">
              {actions.map((a) => (
                <ActionChip key={a.id} id={a.id} name={a.name} icon={a.icon} confirm={a.confirm} />
              ))}
            </div>
          </section>
        )}

        {panel.sections.sleep && (
          <section className="col" style={{ gap: 8 }}>
            <div className="section-title">
              <span>
                Sleep timer
                {sleep && <SleepLeft endsAt={sleep.endsAt} />}
              </span>
            </div>
            <Segment label="Sleep timer" value={sleepValue as 'off'} onChange={(v) => void setSleep(v)} options={SLEEP_CHOICES.concat(sleepValue === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])} />
          </section>
        )}

        {/* The way out: always here, whatever is configured above. Not configurable, on purpose. */}
        <div className="qp-foot" role="group" aria-label="Go to">
          <button type="button" className="btn" onClick={() => go('home')}>
            <House /> Home
          </button>
          <button type="button" className="btn" onClick={() => go('apps')}>
            <LayoutGrid /> Apps
          </button>
          <button type="button" className="btn" onClick={() => go('settings')}>
            <Settings /> Settings
          </button>
        </div>
        <button type="button" className="btn ghost" data-locked={locked || undefined} aria-disabled={locked || undefined} onClick={() => void openNavEditor()}>
          <PencilLine /> {locked ? 'Park to edit navigation' : 'Edit navigation'}
        </button>
      </div>
    </>
  );
}

/** One quick action. One that is marked "confirm" needs a second tap, so a stray touch cannot open a garage door. */
export function ActionChip({ id, name, icon, confirm }: { id: string; name: string; icon: ActionIcon; confirm: boolean }) {
  const toast = useHeadUnit((s) => s.showToast);
  const { busy, run } = useAction();
  const Icon = ACTION_GLYPHS[icon] ?? Zap;
  const [armed, setArmed] = useArmed();
  const fire = () =>
    run(async () => {
      const r = await apiRequest<{ ok: boolean; message: string }>(`/api/actions/${id}/run`, 'POST');
      toast(`${name}: ${r.message}`);
    });
  return (
    <button
      type="button"
      className="chip"
      data-active={armed}
      disabled={busy}
      onClick={() => {
        if (confirm && !armed) return setArmed(true);
        setArmed(false);
        void fire();
      }}
    >
      <Icon size={16} />
      {armed ? `Tap again: ${name}` : name}
    </button>
  );
}
