import { Ghost, Move, Sparkles } from 'lucide-react';
import { DEFAULT_SETTINGS, MASCOT_AURAS, MASCOT_MOTIONS, MASCOT_VARIANTS } from '@headunit/shared';
import { ChoiceChips, ConfirmButton, Segment, SliderRow, SwitchRow } from '../../components/ui';
import { MASCOT_AURA_INFO, MASCOT_INFO, MASCOT_MOTION_INFO, optionsOf } from '../../lib/appearanceInfo';
import { MASCOT_ASSETS } from '../../layers/Mascot';
import { useHeadUnit } from '../../store';
import { SetSection, Tiles } from './parts';

const MASCOT_KEYS = ['mascotEnabled', 'mascotVariant', 'mascotMotion', 'mascotAura', 'mascotPlacement', 'mascotScope', 'mascotX', 'mascotY', 'mascotSize', 'mascotOpacity', 'mascotGlow', 'mascotBeat', 'mascotMirror'] as const;

/** Your mascot: which artwork, where it stands, how it moves and what light is around it. It never replaces a wallpaper or the album art. */
export function MascotSection() {
  const s = useHeadUnit((st) => st.settings);
  const patch = useHeadUnit((st) => st.patchSettings);
  if (!s) return null;
  const off = !s.mascotEnabled;
  return (
    <>
      <SetSection title="Mascot" icon={Ghost} blurb="A separate layer over your background. Some layouts and looks place it inside a card instead, so it never shows twice.">
        <SwitchRow label="Show the mascot" on={s.mascotEnabled} onChange={(mascotEnabled) => patch({ mascotEnabled })} />
        <Tiles
          label="Mascot artwork"
          value={s.mascotVariant}
          onChange={(mascotVariant) => patch({ mascotVariant })}
          options={MASCOT_VARIANTS.map((v) => ({ value: v, ...MASCOT_INFO[v], preview: <img className="mascot-pic" src={MASCOT_ASSETS[v]} alt="" loading="lazy" draggable={false} /> }))}
        />
      </SetSection>
      <SetSection title="Movement and light" icon={Sparkles} blurb="It rests while you drive, when motion is off, and when the system asks for less motion.">
        <ChoiceChips value={s.mascotMotion} onChange={(mascotMotion) => patch({ mascotMotion })} options={optionsOf(MASCOT_MOTION_INFO, MASCOT_MOTIONS)} />
        <ChoiceChips value={s.mascotAura} onChange={(mascotAura) => patch({ mascotAura })} options={optionsOf(MASCOT_AURA_INFO, MASCOT_AURAS)} />
        <SliderRow label="Glow" value={s.mascotGlow} unit="%" onCommit={(mascotGlow) => patch({ mascotGlow })} disabled={off} />
        <SwitchRow label="Pulse with the music" hint="Uses the music-reactive meter when it is on; never an invented beat." on={s.mascotBeat} onChange={(mascotBeat) => patch({ mascotBeat })} disabled={off} />
      </SetSection>
      <SetSection title="Where it stands" icon={Move} blurb="Or open Home → edit and drag it.">
        <Segment
          label="Where"
          value={s.mascotScope}
          onChange={(mascotScope) => patch({ mascotScope })}
          options={[
            { value: 'home', label: 'Home only' },
            { value: 'all', label: 'Every page' },
          ]}
        />
        <Segment
          label="Layer"
          value={s.mascotPlacement}
          onChange={(mascotPlacement) => patch({ mascotPlacement })}
          options={[
            { value: 'behind', label: 'Behind the widgets' },
            { value: 'front', label: 'In front' },
          ]}
        />
        <SliderRow label="Across" value={s.mascotX} unit="%" onCommit={(mascotX) => patch({ mascotX })} disabled={off} />
        <SliderRow label="Up and down" value={s.mascotY} unit="%" onCommit={(mascotY) => patch({ mascotY })} disabled={off} />
        <SliderRow label="Size" value={s.mascotSize} min={10} max={95} unit="%" onCommit={(mascotSize) => patch({ mascotSize })} disabled={off} />
        <SliderRow label="Visibility" value={s.mascotOpacity} unit="%" onCommit={(mascotOpacity) => patch({ mascotOpacity })} disabled={off} />
        <SwitchRow label="Mirror left and right" on={s.mascotMirror} onChange={(mascotMirror) => patch({ mascotMirror })} disabled={off} />
        <div className="row">
          <ConfirmButton className="btn" label="Reset the mascot" confirmLabel="Tap again to reset" onConfirm={() => patch(Object.fromEntries(MASCOT_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])))} />
        </div>
      </SetSection>
    </>
  );
}
