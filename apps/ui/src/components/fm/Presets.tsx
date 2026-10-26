import { Star, StarOff } from 'lucide-react';
import type { PresetsView } from '../../lib/fm';

/** What the save / remove button is called for a screen reader (it starts with the words drawn on it). `current` is null when the dial has no frequency. */
export const saveLabel = (saved: boolean, current: string | null): string =>
  current === null ? 'Save this frequency' : saved ? `Remove ${current} megahertz from the saved frequencies` : `Save this frequency, ${current} megahertz`;

/** Saved frequencies as chips (tap to tune), and one button to save or remove the frequency on the dial. */
export function Presets({ view, current, busy, onTune, onToggle }: { view: PresetsView; current: string | null; busy: boolean; onTune(frequency: number): void; onToggle(): void }) {
  return (
    <div className="fm-presets">
      {view.chips.length > 0 && (
        <div className="fm-chips" role="group" aria-label="Saved frequencies">
          {view.chips.map((c) => (
            <button key={c.frequency} type="button" className="fm-chip" aria-pressed={c.active} aria-label={`Tune to ${c.text} megahertz`} onClick={() => onTune(c.frequency)}>
              {c.text}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn fm-save" disabled={busy || view.disabled} aria-label={saveLabel(view.saved, current)} onClick={onToggle}>
        {view.saved ? <StarOff size={18} /> : <Star size={18} />}
        {view.saved ? 'Remove' : 'Save this'}
      </button>
      {view.hint && <p className="fm-note">{view.hint}</p>}
    </div>
  );
}
