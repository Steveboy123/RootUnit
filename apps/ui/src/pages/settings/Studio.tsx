import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Box, Cloud, Gauge as GaugeIcon, Image as ImageIcon, ImageUp, Layers, Mic, MicOff, MoonStar, Music4, Palette as PaletteIcon, Sparkles, Type } from 'lucide-react';
import {
  ALBUM_MOTIONS,
  BACKGROUNDS,
  BEAT_COLORS,
  BEAT_MODES,
  BUILTIN_WALLPAPERS,
  DASH_SCENES,
  DEPTH_STYLES,
  EFFECTS,
  FONTS,
  GAUGE_STYLES,
  GLASS_FINISHES,
  MOTION_SPEEDS,
  PAGE_TRANSITIONS,
  SHAPES,
  STANDBY_STYLES,
  SURFACES,
  TOUCH_FX,
  type Settings,
  type ThemeId,
} from '@headunit/shared';
import { enableMicrophoneMeter, microphoneIsOn, stopMicrophoneMeter } from '../../audio/reactive';
import { AlbumArt } from '../../components/AlbumArt';
import { Gauge } from '../../components/Gauge';
import { Banner, ChoiceChips, Segment, SliderRow, SwitchRow, TextField } from '../../components/ui';
import { useApi } from '../../lib/api';
import {
  ALBUM_MOTION_INFO,
  BACKGROUND_INFO,
  BEAT_COLOR_INFO,
  BEAT_INFO,
  DEPTH_INFO,
  EFFECTS_INFO,
  FONT_INFO,
  GAUGE_INFO,
  GLASS_INFO,
  MOTION_INFO,
  SCENE_INFO,
  SHAPE_INFO,
  STANDBY_INFO,
  SURFACE_INFO,
  TOUCH_INFO,
  TRANSITION_INFO,
  optionsOf,
} from '../../lib/appearanceInfo';
import { displayModeOf, displayModePatch } from '../../lib/displayMode';
import { useNowPlaying } from '../../lib/nowPlaying';
import { HIGH_VISIBILITY, PALETTE_LIST, previewOf, type Palette } from '../../lib/themes';
import { WALLPAPER_LABELS, wallpaperUrl } from '../../lib/wallpapers';
import { useHeadUnit } from '../../store';
import { Field, SetSection, Tiles, type TileOption } from './parts';

type Patch = (p: Partial<Settings>) => void;
const useSettings = () => ({ s: useHeadUnit((st) => st.settings), patch: useHeadUnit((st) => st.patchSettings) as Patch });

/** A palette's tile picture: its three preview colours and a sample card. */
function PaletteSwatch({ p }: { p: Palette }) {
  return (
    <span className="pal-pic" style={{ background: `linear-gradient(135deg, ${p.preview[0]}, ${p.preview[1]} 55%, ${p.preview[2]})` }}>
      <i style={{ background: p.card, borderColor: p.border }}>
        <em style={{ background: p.accentDefault }} />
        <b style={{ background: p.text }} />
      </i>
    </span>
  );
}

function paletteOptions(list: readonly Palette[]): TileOption<ThemeId>[] {
  return list.map((p) => ({ value: p.id, label: p.label, blurb: p.blurb, preview: <PaletteSwatch p={p} /> }));
}

export function ColoursSection() {
  const { s, patch } = useSettings();
  const groups = useMemo(
    () => [
      { id: 'dark', label: 'Dark', list: PALETTE_LIST.filter((p) => p.scheme === 'dark' && !HIGH_VISIBILITY.has(p.id)) },
      { id: 'light', label: 'Light', list: PALETTE_LIST.filter((p) => p.scheme === 'light' && !HIGH_VISIBILITY.has(p.id)) },
      { id: 'hv', label: 'High visibility', list: PALETTE_LIST.filter((p) => HIGH_VISIBILITY.has(p.id)) },
    ],
    [],
  );
  if (!s) return null;
  const mode = displayModeOf(s);
  return (
    <>
      <SetSection title="Day and night" icon={MoonStar} blurb="Switch palettes by themselves: on a schedule, or at the real sunset where the car is.">
        <Segment
          label="Day and night"
          value={mode === 'custom' ? 'custom' : mode}
          onChange={(m) => m !== 'custom' && patch(displayModePatch(m, s))}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'day', label: 'Day' },
            { value: 'night', label: 'Night' },
            ...(mode === 'custom' ? [{ value: 'custom' as const, label: 'My palette' }] : []),
          ]}
        />
        {s.autoTheme && (
          <>
            <Field label="Switch by">
              <Segment
                label="Switch by"
                value={s.autoThemeMode}
                onChange={(autoThemeMode) => patch({ autoThemeMode })}
                options={[
                  { value: 'sun', label: 'Sunrise & sunset' },
                  { value: 'schedule', label: 'Clock' },
                ]}
              />
            </Field>
            {s.autoThemeMode === 'schedule' && (
              <div className="row wrap">
                <TextField label="Night from" type="time" value={s.nightStart} onChange={(nightStart) => /^\d\d:\d\d$/.test(nightStart) && patch({ nightStart })} />
                <TextField label="until" type="time" value={s.nightEnd} onChange={(nightEnd) => /^\d\d:\d\d$/.test(nightEnd) && patch({ nightEnd })} />
              </div>
            )}
            <Field label="Day palette" stack>
              <ChoiceChips scroll value={s.dayTheme} onChange={(dayTheme) => patch({ dayTheme })} options={PALETTE_LIST.map((p) => ({ value: p.id, label: p.label, swatch: p.accentDefault }))} />
            </Field>
            <Field label="Night palette" stack>
              <ChoiceChips scroll value={s.nightTheme} onChange={(nightTheme) => patch({ nightTheme })} options={PALETTE_LIST.map((p) => ({ value: p.id, label: p.label, swatch: p.accentDefault }))} />
            </Field>
          </>
        )}
      </SetSection>
      {groups.map((g) => (
        <SetSection key={g.id} title={`${g.label} palettes`} icon={PaletteIcon}>
          <Tiles label={`${g.label} palettes`} value={s.theme} onChange={(theme) => patch({ theme, autoTheme: false })} options={paletteOptions(g.list)} size="sm" />
        </SetSection>
      ))}
    </>
  );
}

/** A tile picture that is a real card in that combination (the surface CSS reads the attributes from the box). */
function SurfacePic({ over }: { over: Partial<Settings> }) {
  const theme = useHeadUnit((s) => s.settings?.theme ?? 'obsidian');
  const accent = useHeadUnit((s) => s.settings?.accent);
  const { vars, attrs } = useMemo(() => previewOf({ ...over, theme, accent }), [over, theme, accent]);
  return (
    <span className="surf-pic" style={vars} {...attrs}>
      <span className="card">
        <i />
        <b />
      </span>
    </span>
  );
}

export function StyleSection() {
  const { s, patch } = useSettings();
  if (!s) return null;
  const glassy = s.surface === 'glass' || s.surface === 'aero';
  return (
    <>
      <SetSection title="Cards" icon={Box} blurb="How every card, widget and panel is drawn.">
        <Tiles label="Card style" value={s.surface} onChange={(surface) => patch({ surface })} options={SURFACES.map((v) => ({ value: v, ...SURFACE_INFO[v], preview: <SurfacePic over={{ surface: v, depthStyle: s.depthStyle }} /> }))} />
      </SetSection>
      <SetSection title="Depth" icon={Layers}>
        <Tiles label="Depth" value={s.depthStyle} onChange={(depthStyle) => patch({ depthStyle })} options={DEPTH_STYLES.map((v) => ({ value: v, ...DEPTH_INFO[v], preview: <SurfacePic over={{ surface: s.surface, depthStyle: v }} /> }))} size="sm" />
      </SetSection>
      <SetSection title="Glass" icon={Sparkles} blurb={glassy ? 'The finish of the glass, and how see-through it is.' : 'For the Glass and Aero card styles.'}>
        <Tiles label="Glass finish" value={s.glassFinish} onChange={(glassFinish) => patch({ glassFinish })} options={GLASS_FINISHES.map((v) => ({ value: v, ...GLASS_INFO[v], preview: <SurfacePic over={{ surface: 'glass', glassFinish: v }} /> }))} size="sm" />
        <SliderRow label="See-through" value={s.glassOpacity} unit="%" onCommit={(glassOpacity) => patch({ glassOpacity })} disabled={!glassy} />
      </SetSection>
      <SetSection title="Corners" icon={Box}>
        <Segment label="Corners" value={s.shape} onChange={(shape) => patch({ shape })} options={optionsOf(SHAPE_INFO, SHAPES)} />
      </SetSection>
    </>
  );
}

interface WallpaperFile {
  name: string;
  size: number;
}

export function BackgroundSection() {
  const { s, patch } = useSettings();
  const files = useApi<{ files: WallpaperFile[] }>('/api/wallpapers');
  const np = useNowPlaying();
  if (!s) return null;
  const builtins = BUILTIN_WALLPAPERS.map((id) => ({ id, label: WALLPAPER_LABELS[id] }));
  const mine = (files.data?.files ?? []).filter((f) => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/.test(f.name) && !f.name.includes('..')).map((f) => ({ id: `user:${f.name}`, label: f.name }));
  const art = BACKGROUND_INFO[s.background].art;
  return (
    <>
      <SetSection title="Background" icon={ImageIcon} blurb="What sits behind everything.">
        <ChoiceChips value={s.background} onChange={(background) => patch({ background })} options={BACKGROUNDS.map((b) => ({ value: b, label: BACKGROUND_INFO[b].label }))} />
        {art && !np?.artUrl && <Banner>Made from the album art of what is playing. Until something plays, a soft gradient in your accent is shown.</Banner>}
      </SetSection>
      <SetSection title="Wallpapers" icon={ImageIcon} blurb="Built-in scenes and your own pictures: add one here (from this screen or a phone) or copy it into the head unit’s wallpapers folder.">
        <WallpaperUpload
          onSaved={(wallpaper) => {
            files.reload();
            patch({ background: 'wallpaper', wallpaper });
          }}
        />
        <div className="wp-grid stagger" role="radiogroup" aria-label="Wallpaper">
          {[...builtins, ...mine].map((w, i) => {
            const on = s.background === 'wallpaper' && s.wallpaper === w.id;
            return (
              <button key={w.id} type="button" role="radio" aria-checked={on} className="wp-tile" data-active={on} style={{ ['--i' as string]: i }} onClick={() => patch({ background: 'wallpaper', wallpaper: w.id })}>
                <span className="wp-pic" style={{ backgroundImage: `url("${wallpaperUrl(w.id)}")` }} />
                <small className="truncate">{w.label}</small>
              </button>
            );
          })}
        </div>
      </SetSection>
      <SetSection title="Over the background" icon={Layers}>
        <SliderRow label="Dim" value={s.bgDim} max={90} unit="%" onCommit={(bgDim) => patch({ bgDim })} disabled={s.background === 'none'} hint="Bright pictures are darkened by themselves as far as the text needs." />
        <SliderRow label="Blur" value={s.bgBlur} max={60} unit=" px" onCommit={(bgBlur) => patch({ bgBlur })} disabled={s.background !== 'art-blur' || s.effects === 'minimal'} />
      </SetSection>
      <SetSection title="Animated scene" icon={Cloud} blurb="Moving light behind the Home widgets. It rests while you drive.">
        <ChoiceChips value={s.dashScene} onChange={(dashScene) => patch({ dashScene })} options={DASH_SCENES.map((d) => ({ value: d, label: SCENE_INFO[d].label }))} />
        <SliderRow label="How busy" value={s.sceneIntensity} min={10} unit="%" onCommit={(sceneIntensity) => patch({ sceneIntensity })} disabled={s.dashScene === 'off'} />
        <SwitchRow label="Real weather in the scene" hint="Rain, snow, fog or stars when the weather has them." on={s.weatherFx} onChange={(weatherFx) => patch({ weatherFx })} disabled={!s.weather} />
      </SetSection>
    </>
  );
}

/** Adds a picture straight from the screen and chooses it; the server checks it is a real image and never overwrites a file. */
function WallpaperUpload({ onSaved }: { onSaved(id: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote('Adding the picture…');
    try {
      const r = await fetch(`/api/wallpapers/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const body = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !body.id) throw new Error(body.error ?? 'The picture could not be added.');
      onSaved(body.id);
      setNote('Added and chosen as your wallpaper.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The picture could not be added.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap">
      <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
        <ImageUp size={16} /> Add your own picture
      </button>
      <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
      <span className="dim small" role="status">
        {note || 'PNG, JPEG, WebP or AVIF, up to 12 MB.'}
      </span>
    </div>
  );
}

/** "3D effects": how much moves, the artwork style, glow, background motion and particles, and how screens change. */
export function MotionSection() {
  const { s, patch } = useSettings();
  const np = useNowPlaying();
  if (!s) return null;
  return (
    <>
      <SetSection title="3D effects" icon={Sparkles} blurb="How much the screen may animate. Everything rests while you drive and when the system asks for less motion.">
        <Field label="Effects" hint={EFFECTS_INFO[s.effects].blurb} stack>
          <Segment label="Effects" value={s.effects} onChange={(effects) => patch({ effects })} options={optionsOf(EFFECTS_INFO, EFFECTS)} />
        </Field>
        <Field label="Motion intensity" hint={MOTION_INFO[s.motionSpeed].blurb} stack>
          <Segment label="Motion intensity" value={s.motionSpeed} onChange={(motionSpeed) => patch({ motionSpeed })} options={optionsOf(MOTION_INFO, MOTION_SPEEDS)} />
        </Field>
        <div className="switch-grid">
          <SwitchRow label="Album glow" on={s.albumGlow} onChange={(albumGlow) => patch({ albumGlow })} />
          <SwitchRow label="Background motion" on={s.bgMotion} onChange={(bgMotion) => patch({ bgMotion })} />
          <SwitchRow label="Particle effects" on={s.dashScene !== 'off'} onChange={(on) => patch({ dashScene: on ? 'particles' : 'off' })} />
        </div>
      </SetSection>
      <SetSection title="Artwork style" icon={Music4} blurb="How the album cover is drawn on Home and Now Playing.">
        <Tiles
          label="Artwork style"
          value={s.albumMotion}
          onChange={(albumMotion) => patch({ albumMotion })}
          options={ALBUM_MOTIONS.map((m) => ({ value: m, ...ALBUM_MOTION_INFO[m], preview: <AlbumArt mode={m} artUrl={np?.artUrl} playing={Boolean(np?.playing)} size="sm" /> }))}
          size="sm"
        />
      </SetSection>
      <SetSection title="Moving between screens" icon={Activity}>
        <Field label="Page transition" stack>
          <ChoiceChips value={s.transition} onChange={(transition) => patch({ transition })} options={optionsOf(TRANSITION_INFO, PAGE_TRANSITIONS)} />
        </Field>
        <Field label="When you touch" stack>
          <ChoiceChips value={s.touchFx} onChange={(touchFx) => patch({ touchFx })} options={optionsOf(TOUCH_INFO, TOUCH_FX)} />
        </Field>
      </SetSection>
    </>
  );
}

export function TypeSection() {
  const { s, patch } = useSettings();
  if (!s) return null;
  return (
    <>
      <SetSection title="Typeface" icon={Type} blurb="All bundled: nothing is downloaded.">
        <Tiles
          label="Typeface"
          value={s.font}
          onChange={(font) => patch({ font })}
          options={FONTS.map((f) => ({
            value: f,
            ...FONT_INFO[f],
            preview: (
              <span className="font-pic" style={{ fontFamily: FONT_INFO[f].family }}>
                Aa 12:45
              </span>
            ),
          }))}
          size="sm"
        />
        <SliderRow label="Text size" value={s.textScale} min={85} max={130} step={5} unit="%" onCommit={(textScale) => patch({ textScale })} />
      </SetSection>
      <SetSection title="Gauges" icon={GaugeIcon}>
        <Tiles
          label="Gauge style"
          value={s.gaugeStyle}
          onChange={(gaugeStyle) => patch({ gaugeStyle })}
          options={GAUGE_STYLES.map((g) => ({
            value: g,
            ...GAUGE_INFO[g],
            preview: (
              <span className="gauge-pic">
                <Gauge value={72} min={0} max={160} major={40} display="72" unit="km/h" styleOverride={g} />
              </span>
            ),
          }))}
          size="sm"
        />
      </SetSection>
      <SetSection title="Standby screen" icon={MoonStar} blurb="What shows when the screen rests while parked.">
        <ChoiceChips value={s.standbyStyle} onChange={(standbyStyle) => patch({ standbyStyle })} options={optionsOf(STANDBY_INFO, STANDBY_STYLES)} />
      </SetSection>
    </>
  );
}

export function BeatSection() {
  const { s, patch } = useSettings();
  if (!s) return null;
  const off = s.beatMode === 'off';
  return (
    <>
      <SetSection title="Music reactive" icon={Activity} blurb="Light that follows the real music, above the background and below every button. Nothing is ever made up: with no sound captured, it stays dark.">
        <ChoiceChips value={s.beatMode} onChange={(beatMode) => patch({ beatMode })} options={optionsOf(BEAT_INFO, BEAT_MODES)} />
        {!off && (
          <>
            <Field label="Listen to" hint={s.beatSource === 'microphone' ? 'The browser asks before it uses the microphone; nothing is recorded or sent.' : 'The sound the head unit plays (needs the audio loopback set up).'} stack>
              <Segment
                label="Listen to"
                value={s.beatSource}
                onChange={(beatSource) => patch({ beatSource })}
                options={[
                  { value: 'system', label: 'Head unit sound' },
                  { value: 'microphone', label: 'Microphone' },
                ]}
              />
            </Field>
            <BeatSourceStatus source={s.beatSource} />
            <Field label="Colour" stack>
              <ChoiceChips value={s.beatColorMode} onChange={(beatColorMode) => patch({ beatColorMode })} options={optionsOf(BEAT_COLOR_INFO, BEAT_COLORS)} />
            </Field>
            {s.beatColorMode === 'custom' && (
              <Field label="Your colour">
                <input type="color" className="color-input" aria-label="Music reactive colour" value={s.beatColor} onChange={(e) => patch({ beatColor: e.target.value })} />
              </Field>
            )}
            <SliderRow label="Intensity" value={s.beatIntensity} unit="%" onCommit={(beatIntensity) => patch({ beatIntensity })} />
            <SliderRow label="Sensitivity" value={s.beatSensitivity} unit="%" onCommit={(beatSensitivity) => patch({ beatSensitivity })} />
          </>
        )}
      </SetSection>
    </>
  );
}

/**
 * Whether the chosen source is really listening. The head unit's audio monitor is asked every few seconds; the microphone starts
 * only from a tap here, so the browser's permission question always follows something the person did.
 */
function BeatSourceStatus({ source }: { source: 'system' | 'microphone' }) {
  const [monitor, setMonitor] = useState('');
  const [mic, setMic] = useState('');
  useEffect(() => {
    if (source !== 'system') return;
    let live = true;
    const check = async () => {
      try {
        const r = await fetch('/api/audio/meter', { cache: 'no-store' });
        const m = (await r.json()) as { available?: boolean; error?: string };
        if (live) setMonitor(m.available ? 'Listening to what the head unit plays.' : (m.error ?? 'The head unit’s audio monitor is not set up.'));
      } catch {
        if (live) setMonitor('The head unit’s audio monitor cannot be reached.');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 4000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [source]);
  if (source === 'system') {
    return (
      <span className="dim small" role="status">
        {monitor || 'Checking the audio monitor…'}
      </span>
    );
  }
  const on = microphoneIsOn();
  const start = async () => {
    try {
      await enableMicrophoneMeter();
      setMic('Listening. Nothing is recorded or sent.');
    } catch (e) {
      setMic(e instanceof Error ? e.message : 'The microphone could not be started.');
    }
  };
  return (
    <div className="row wrap">
      <button type="button" className="btn small" onClick={() => void start()}>
        <Mic size={16} /> Start microphone
      </button>
      <button
        type="button"
        className="btn small"
        disabled={!on}
        onClick={() => {
          stopMicrophoneMeter();
          setMic('Microphone stopped.');
        }}
      >
        <MicOff size={16} /> Stop
      </button>
      <span className="dim small" role="status">
        {mic || (on ? 'Listening. Nothing is recorded or sent.' : 'Tap Start; the browser asks first.')}
      </span>
    </div>
  );
}
