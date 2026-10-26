import type { NavConfig, NavLabelMode, NavPosition, NavPresetId, NavSize } from '@headunit/shared';
import { NAV_PRESETS } from '@headunit/shared';
import { applyPreset, sameNav, setLook } from '../../../lib/navEdit';
import { ConfirmButton, Segment } from '../../../components/ui';

const POSITIONS: Array<{ value: NavPosition; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];
const SIZES: Array<{ value: NavSize; label: string }> = [
  { value: 'compact', label: 'Small' },
  { value: 'regular', label: 'Medium' },
  { value: 'large', label: 'Large' },
];
const LABELS: Array<{ value: NavLabelMode; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'active', label: 'Current page' },
  { value: 'never', label: 'Never' },
];
const PRESETS: Array<{ id: NavPresetId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'driver', label: 'Driver' },
];

/** Which ready-made arrangement the rail is exactly (its buttons, size and names; the side is the person's own), if any. */
export function matchingPreset(config: NavConfig): NavPresetId | null {
  return PRESETS.find((p) => sameNav(applyPreset(config, p.id), config))?.id ?? null;
}

export interface NavLookProps {
  config: NavConfig;
  onChange(next: NavConfig): void;
}

/** The Look tab: where the rail is, how big, when names show, and the ready-made arrangements. No typing anywhere. */
export function NavLook({ config, onChange }: NavLookProps) {
  const current = matchingPreset(config);
  return (
    <div className="ne-look">
      <section className="ne-group">
        <h3 className="ne-h">Side of the screen</h3>
        <Segment label="Side of the screen" value={config.position} options={POSITIONS} onChange={(position) => onChange(setLook(config, { position }))} />
      </section>
      <section className="ne-group">
        <h3 className="ne-h">Size</h3>
        <Segment label="Size" value={config.size} options={SIZES} onChange={(size) => onChange(setLook(config, { size }))} />
      </section>
      <section className="ne-group">
        <h3 className="ne-h">Names under the pictures</h3>
        <Segment label="Names under the pictures" value={config.labels} options={LABELS} onChange={(labels) => onChange(setLook(config, { labels }))} />
      </section>
      <section className="ne-group">
        <h3 className="ne-h">Ready-made</h3>
        <div className="chips" role="group" aria-label="Ready-made arrangements">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="chip ne-chip" data-on={current === p.id} aria-pressed={current === p.id} onClick={() => onChange(applyPreset(config, p.id))}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="ne-hint">
          Default: Home, Drive, Music, Auto and Apps. Minimal: Home, Music and Auto, names on the current page only. Driver: Drive, Music and Auto, large buttons. They replace your buttons;
          Revert takes it back.
        </p>
      </section>
      <ConfirmButton
        label="Reset the look"
        confirmLabel="Tap again to reset"
        className="btn danger ne-btn wide"
        onConfirm={() => onChange(setLook(config, { position: NAV_PRESETS.default.position, size: NAV_PRESETS.default.size, labels: NAV_PRESETS.default.labels }))}
      />
    </div>
  );
}
