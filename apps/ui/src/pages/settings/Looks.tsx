import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LayoutDashboard, Palette, RotateCcw, Sparkles } from 'lucide-react';
import type { Settings } from '@headunit/shared';
import { ConfirmButton, Segment, SliderRow, SwitchRow } from '../../components/ui';
import { ACCENT_HUE, ACCENT_LIGHTNESS, hexToHsl, pickAccent, ratioText } from '../../lib/accentPicker';
import { appearanceResetPatch } from '../../lib/appearanceReset';
import { useNow } from '../../lib/hooks';
import { usePlace } from '../../lib/place';
import { effectiveTheme } from '../../lib/theme';
import { LAYOUT_PRESETS, layoutOf, type LayoutPreset } from '../../lib/layoutPresets';
import { ACCENT_SWATCHES, PRESETS, PRESET_GROUPS, accentFor, activePreset, contrastRatio, paletteOf, presetPatch, previewOf, type Preset, type PresetGroup } from '../../lib/themes';
import { wallpaperUrl } from '../../lib/wallpapers';
import { useHeadUnit } from '../../store';
import { SetSection, Swatches } from './parts';

/**
 * A look's gallery tile: its wallpaper (or its palette's colours), with a small card and a dock drawn in the look's own colours on top,
 * so the tile shows what the screen will look like rather than a name.
 */
function LookThumb({ preset }: { preset: Preset }) {
  const { vars, attrs } = useMemo(() => previewOf(preset.patch), [preset]);
  const pal = paletteOf(preset.patch.theme);
  const url = preset.thumb ? wallpaperUrl(preset.thumb) : null;
  const bg = url ? `center / cover no-repeat url("${url}")` : `linear-gradient(135deg, ${pal.preview[0]}, ${pal.preview[1]} 60%, ${pal.preview[2]})`;
  return (
    <span className="look-thumb" style={{ ...vars, background: bg }} {...attrs}>
      <span className="look-thumb-dock" />
      <span className="look-thumb-card card">
        <i />
        <span>
          <b />
          <em />
        </span>
      </span>
      <span className="look-thumb-dot" />
    </span>
  );
}

/** A layout's tile: its first page drawn as boxes on the 12 × 6 grid. */
function LayoutThumb({ preset }: { preset: LayoutPreset }) {
  const page = preset.layout.pages[0]!;
  return (
    <span className="layout-thumb" aria-hidden="true">
      {page.widgets.map((w) => (
        <i key={w.id} data-type={w.type} style={{ gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` }} />
      ))}
    </span>
  );
}

export function LooksSection() {
  const settings = useHeadUnit((s) => s.settings);
  const patch = useHeadUnit((s) => s.patchSettings);
  const setLayout = useHeadUnit((s) => s.setLayout);
  const setPage = useHeadUnit((s) => s.setPage);
  const toast = useHeadUnit((s) => s.showToast);
  const [group, setGroup] = useState<PresetGroup>('featured');
  if (!settings) return null;
  const current = activePreset(settings);
  const list = PRESETS.filter((p) => p.group === group);

  return (
    <>
      <SetSection title="Looks" icon={Sparkles} blurb="One tap sets everything to match: colours, background, motion, type, gauges, the navigation bar and the mascot. You can change any part afterwards.">
        <Segment<PresetGroup> label="Kind of look" value={group} onChange={setGroup} options={PRESET_GROUPS.map((g) => ({ value: g.id, label: g.label }))} />
        <p className="set-blurb">{PRESET_GROUPS.find((g) => g.id === group)?.blurb}</p>
        <div className="look-grid stagger" key={group} role="radiogroup" aria-label="Looks">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={current?.id === p.id}
              className="look-tile"
              data-active={current?.id === p.id}
              style={{ ['--i' as string]: i }}
              onClick={() => {
                patch(presetPatch(p));
                toast(`${p.label} look`);
              }}
            >
              <LookThumb preset={p} />
              <b>
                {current?.id === p.id && <Check size={15} />} {p.label}
              </b>
              <small>{p.blurb}</small>
            </button>
          ))}
        </div>
      </SetSection>

      <SetSection title="Accent colour" icon={Palette} blurb="The highlight on buttons, gauges and the navigation. Any colour is made readable on the palette you have.">
        <Swatches label="Accent colour" value={settings.accent} colours={ACCENT_SWATCHES} onChange={(accent) => patch({ accent })} />
        <CustomAccent settings={settings} onPatch={patch} />
        <SwitchRow label="Colour the interface from the album art" hint="While a song plays, its cover’s colour replaces the accent." on={settings.artAccent} onChange={(artAccent) => patch({ artAccent })} />
      </SetSection>

      <SetSection title="Home layouts" icon={LayoutDashboard} blurb="Ready-made dashboards. Using one replaces your Home pages; every widget can still be moved, resized or removed after.">
        <div className="layout-grid">
          {LAYOUT_PRESETS.map((p) => (
            <div key={p.id} className="layout-card">
              <LayoutThumb preset={p} />
              <b>{p.label}</b>
              <small>{p.blurb}</small>
              <ConfirmButton
                className="btn small"
                label="Use this layout"
                confirmLabel="Tap again: replaces Home"
                onConfirm={() => {
                  const l = layoutOf(p);
                  setLayout(l);
                  setPage(l.pages[0]!.id);
                  if (p.mascot) patch(p.mascot);
                  toast(`${p.label} layout on Home`);
                }}
              />
            </div>
          ))}
        </div>
      </SetSection>

      <SetSection title="Start again" icon={RotateCcw} blurb="Puts every colour, card, background, motion, type, mascot and navigation-style setting back as it came. Units, music, text size, your navigation buttons and your Home pages stay as they are.">
        <div className="row">
          <ConfirmButton
            className="btn danger"
            label="Reset the look"
            confirmLabel="Tap again to reset the look"
            onConfirm={() => {
              patch(appearanceResetPatch());
              toast('The look is back to how it came');
            }}
          />
        </div>
      </SetSection>
    </>
  );
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * Any accent at all: hue and lightness. The colour is checked against the palette in force (day or night) and nudged only as far as it
 * must be to stay readable; the sample below says so when that happens.
 */
function CustomAccent({ settings, onPatch }: { settings: Settings; onPatch(patch: Partial<Settings>): void }) {
  const now = useNow(30_000);
  const place = usePlace();
  const palette = paletteOf(effectiveTheme(settings, now, place));
  const accent = settings.accent;
  const start = hexToHsl(accent);
  const [hue, setHue] = useState(clampInt(start.h, ACCENT_HUE.min, ACCENT_HUE.max));
  const [light, setLight] = useState(clampInt(start.l, ACCENT_LIGHTNESS.min, ACCENT_LIGHTNESS.max));
  /** The last colour these sliders sent, and whether it had to be nudged. */
  const sent = useRef<{ accent: string; adjusted: boolean } | null>(null);

  // A swatch, a look or a reset changed the accent from outside: follow it. Our own patches come back equal to what we sent.
  useEffect(() => {
    if (accent === sent.current?.accent) return;
    const hsl = hexToHsl(accent);
    setHue(clampInt(hsl.h, ACCENT_HUE.min, ACCENT_HUE.max));
    setLight(clampInt(hsl.l, ACCENT_LIGHTNESS.min, ACCENT_LIGHTNESS.max));
  }, [accent]);

  const send = (h: number, l: number) => {
    const picked = pickAccent(palette, h, l);
    sent.current = { accent: picked.accent, adjusted: picked.adjusted };
    onPatch({ accent: picked.accent });
  };
  const shown = accentFor(palette, accent);
  const adjusted = accent === sent.current?.accent ? sent.current.adjusted : shown.accent !== accent.toLowerCase();

  return (
    <div className="accent-custom">
      <SliderRow
        label="Hue"
        min={ACCENT_HUE.min}
        max={ACCENT_HUE.max}
        unit="°"
        value={hue}
        onCommit={(h) => {
          setHue(h);
          send(h, light);
        }}
      />
      <i className="accent-hues" aria-hidden="true" />
      <SliderRow
        label="Lightness"
        min={ACCENT_LIGHTNESS.min}
        max={ACCENT_LIGHTNESS.max}
        unit="%"
        value={light}
        onCommit={(l) => {
          setLight(l);
          send(hue, l);
        }}
      />
      <div className="accent-sample">
        <span className="accent-chip" style={{ background: shown.accent, color: shown.onAccent }}>
          Sample
        </span>
        <span className="dim small">
          <b className="num">{shown.accent.toUpperCase()}</b> · {ratioText(contrastRatio(shown.accent, palette.bg))} against the background
          {adjusted ? ' · adjusted to stay readable' : ''}
        </span>
      </div>
    </div>
  );
}
