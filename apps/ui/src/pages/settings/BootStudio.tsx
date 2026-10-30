import { useEffect, useRef, useState } from 'react';
import { ImageUp, MonitorPlay, Palette, RotateCcw, Save, Sparkles, Type, Undo2 } from 'lucide-react';
import { BOOT_CHOICES, BOOT_DEFAULTS, BOOT_PRESET_COLOURS, type BootConfig } from '@headunit/shared';
import { Banner, ChoiceChips, SliderRow, SwitchRow, TextField } from '../../components/ui';
import { Field, SetSection } from './parts';

type Choice<K extends keyof typeof BOOT_CHOICES> = (typeof BOOT_CHOICES)[K][number];

const PRESET_LABEL: Record<Choice<'preset'>, string> = {
  neon: 'Cyber pink',
  glass: 'Crystal blue',
  matrix: 'Matrix green',
  sunset: 'Sunset GT',
  minimal: 'Dark minimal',
  custom: 'Custom',
  hyperdrive: 'Hyperdrive',
  vapor: 'Vaporwave',
  blueprint: 'Blueprint',
  ember: 'Ember',
  plague: 'Plague doctor',
};
const BG_LABEL: Record<Choice<'bg'>, string> = { solid: 'Solid', gradient: 'Gradient', aurora: 'Aurora', grid: '3D grid', image: 'Your photo', stars: 'Stars', warp: 'Warp speed', mesh: 'Colour mesh', synthsun: 'Synth sun' };
const IMAGE_LABEL: Record<Choice<'image'>, string> = { original: 'Original', transparent: 'Neon cut-out', armored: '3D armour', custom: 'Your upload' };
const MOTION_LABEL: Record<Choice<'motion'>, string> = { none: 'Still', float: 'Float', pulse: 'Pulse', tilt: '3D tilt', orbit: 'Orbit', hologram: 'Hologram', glitch: 'Glitch', breathe: 'Breathe', spin3d: '3D spin' };
const LOADER_LABEL: Record<Choice<'loader'>, string> = { bar: 'Sliding bar', ring: 'Neon ring', dots: 'Pulse dots', scanner: 'Laser scan', none: 'Hidden', pulse: 'Pulse', wave: 'Wave', segments: 'Segments', orbit: 'Orbit', heartbeat: 'Heartbeat' };
const TEXT_LABEL: Record<Choice<'textStyle'>, string> = { wide: 'Wide', clean: 'Clean', mono: 'Terminal', neon: 'Neon', glitch: 'Glitch', outline: 'Outline', future: 'Future' };
const TRANSITION_LABEL: Record<Choice<'transition'>, string> = { none: 'Instant', fade: 'Fade', zoom: 'Zoom', slide: 'Slide', iris: 'Iris', warp: 'Warp', shutter: 'Shutter' };

const opts = <K extends keyof typeof BOOT_CHOICES>(key: K, labels: Record<Choice<K>, string>) => (BOOT_CHOICES[key] as readonly Choice<K>[]).map((value) => ({ value, label: labels[value] }));
const DEFAULTS = BOOT_DEFAULTS as BootConfig;

/**
 * The full-screen startup: theme, background, mascot, loader, words and the hand-over to the dashboard. The preview runs the same page
 * and script the Pi shows at boot; nothing changes there until Save.
 */
export function BootStudioSection() {
  const [draft, setDraft] = useState<BootConfig>(DEFAULTS);
  const [saved, setSaved] = useState<BootConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploads, setUploads] = useState(0);
  const preview = useRef<HTMLIFrameElement>(null);
  const mascotFile = useRef<HTMLInputElement>(null);
  const bgFile = useRef<HTMLInputElement>(null);

  const set = <K extends keyof BootConfig>(key: K, value: BootConfig[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setMessage('');
  };
  const colour = (key: 'bgColor' | 'bgColor2' | 'accent' | 'accent2', value: string) => setDraft((d) => ({ ...d, preset: 'custom', [key]: value }));

  useEffect(() => {
    let live = true;
    fetch('/api/boot-studio', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = { ...DEFAULTS, ...((await r.json()) as Partial<BootConfig>) };
        if (live) {
          setDraft(body);
          setSaved(body);
        }
      })
      .catch((e: unknown) => live && setError(`Boot Studio could not load: ${e instanceof Error ? e.message : 'server unavailable'}`));
    return () => {
      live = false;
    };
  }, []);
  const send = () => preview.current?.contentWindow?.postMessage({ type: 'headunit-boot-preview', config: draft }, location.origin);
  useEffect(send, [draft, uploads]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/boot-studio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const body = (await r.json()) as BootConfig & { error?: string };
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setDraft(body);
      setSaved(body);
      setMessage('Saved. The next start-up uses your design.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File | undefined, slot: 'mascot' | 'background') => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) return setError('Choose a picture smaller than 6 MB.');
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/boot-studio/upload?slot=${slot}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const body = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      setDraft((d) => (slot === 'mascot' ? { ...d, image: 'custom', showMascot: true } : { ...d, bg: 'image' }));
      setUploads((n) => n + 1);
      preview.current?.contentWindow?.location.reload();
      setMessage('Picture uploaded. Save to keep it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the picture');
    } finally {
      setBusy(false);
    }
  };
  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);

  return (
    <>
      <SetSection
        title="Boot screen"
        icon={MonitorPlay}
        blurb="The full-screen start-up. The preview runs the real start-up page; nothing changes until you save."
        aside={
          <div className="row">
            <button type="button" className="btn small" disabled={busy || !changed} onClick={() => setDraft(saved ?? DEFAULTS)}>
              <Undo2 size={16} /> Undo
            </button>
            <button type="button" className="btn small" disabled={busy || JSON.stringify(draft) === JSON.stringify(DEFAULTS)} onClick={() => setDraft({ ...DEFAULTS })} title="The design it came with; save to keep it">
              <RotateCcw size={16} /> Default look
            </button>
            <button type="button" className="btn small primary" disabled={busy || !changed} onClick={() => void save()}>
              <Save size={16} /> {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="boot-preview">
          <iframe ref={preview} title="Boot screen preview" src="/api/boot-studio/preview" onLoad={send} />
        </div>
        {error && <Banner tone="warn">{error}</Banner>}
        {message && <Banner tone="ok">{message}</Banner>}
      </SetSection>

      <SetSection title="Theme and colours" icon={Palette}>
        <ChoiceChips value={draft.preset as Choice<'preset'>} onChange={(preset) => setDraft((d) => ({ ...d, preset, ...(preset === 'custom' ? {} : BOOT_PRESET_COLOURS[preset]) }))} options={opts('preset', PRESET_LABEL)} />
        <div className="boot-colours">
          {(
            [
              ['bgColor', 'Background'],
              ['bgColor2', 'Glow'],
              ['accent', 'Main neon'],
              ['accent2', 'Second neon'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="boot-colour">
              <input type="color" className="color-input" aria-label={label} value={draft[key] as string} onChange={(e) => colour(key, e.target.value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </SetSection>

      <SetSection title="Background" icon={ImageUp}>
        <ChoiceChips value={draft.bg as Choice<'bg'>} onChange={(bg) => set('bg', bg)} options={opts('bg', BG_LABEL)} />
        <div className="row">
          <button type="button" className="btn small" disabled={busy} onClick={() => bgFile.current?.click()}>
            <ImageUp size={16} /> Upload a photo
          </button>
          <input hidden ref={bgFile} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => (void upload(e.target.files?.[0], 'background'), (e.target.value = ''))} />
        </div>
        <SliderRow label="Darken" value={draft.dim} max={90} unit="%" onCommit={(v) => set('dim', v)} />
        <SwitchRow label="Floating glow particles" on={draft.particles} onChange={(v) => set('particles', v)} />
      </SetSection>

      <SetSection title="Mascot" icon={Sparkles}>
        <SwitchRow label="Show a mascot" on={draft.showMascot} onChange={(v) => set('showMascot', v)} />
        <ChoiceChips value={draft.image as Choice<'image'>} onChange={(image) => set('image', image)} options={opts('image', IMAGE_LABEL)} />
        <div className="row">
          <button type="button" className="btn small" disabled={busy} onClick={() => mascotFile.current?.click()}>
            <ImageUp size={16} /> Upload your own
          </button>
          <input hidden ref={mascotFile} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => (void upload(e.target.files?.[0], 'mascot'), (e.target.value = ''))} />
        </div>
        <Field label="Motion" stack>
          <ChoiceChips value={draft.motion as Choice<'motion'>} onChange={(motion) => set('motion', motion)} options={opts('motion', MOTION_LABEL)} />
        </Field>
        <SliderRow label="Motion speed" value={draft.motionSpeed} unit="%" onCommit={(v) => set('motionSpeed', v)} />
        <SliderRow label="Across" value={draft.positionX} unit="%" onCommit={(v) => set('positionX', v)} />
        <SliderRow label="Up and down" value={draft.positionY} unit="%" onCommit={(v) => set('positionY', v)} />
        <SliderRow label="Size" value={draft.size} min={10} max={90} unit="%" onCommit={(v) => set('size', v)} />
        <SliderRow label="Visibility" value={draft.opacity} unit="%" onCommit={(v) => set('opacity', v)} />
        <SliderRow label="Neon glow" value={draft.glow} unit="%" onCommit={(v) => set('glow', v)} />
        <SwitchRow label="Mirror" on={draft.mirror} onChange={(v) => set('mirror', v)} />
      </SetSection>

      <SetSection title="Words and loading" icon={Type}>
        <TextField label="Title" value={draft.title} maxLength={38} onChange={(v) => set('title', v)} />
        <TextField label="While loading" value={draft.subtitle} maxLength={72} onChange={(v) => set('subtitle', v)} />
        <TextField label="When ready" value={draft.readyText} maxLength={72} onChange={(v) => set('readyText', v)} />
        <Field label="Lettering" stack>
          <ChoiceChips value={draft.textStyle as Choice<'textStyle'>} onChange={(v) => set('textStyle', v)} options={opts('textStyle', TEXT_LABEL)} />
        </Field>
        <SliderRow label="Title size" value={draft.titleSize} min={14} max={55} unit=" px" onCommit={(v) => set('titleSize', v)} />
        <SwitchRow label="Show what is loading" on={draft.showStatus} onChange={(v) => set('showStatus', v)} />
        <Field label="Progress" hint="It never shows a made-up percentage: it runs until the head unit answers." stack>
          <ChoiceChips value={draft.loader as Choice<'loader'>} onChange={(v) => set('loader', v)} options={opts('loader', LOADER_LABEL)} />
        </Field>
        <Field label="Into the dashboard" stack>
          <ChoiceChips value={draft.transition as Choice<'transition'>} onChange={(v) => set('transition', v)} options={opts('transition', TRANSITION_LABEL)} />
        </Field>
        <SliderRow label="Hand-over time" value={draft.transitionMs} max={1200} step={50} unit=" ms" onCommit={(v) => set('transitionMs', v)} />
        <p className="set-blurb">
          The very first logo appears before the browser starts. After saving, run <code>sudo ./deploy/setup-boot-experience.sh sync</code> on the Pi to give it your colours and picture.
        </p>
      </SetSection>
    </>
  );
}
