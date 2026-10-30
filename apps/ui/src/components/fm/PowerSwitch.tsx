import { SWITCH_TITLE, type SwitchView } from '../../lib/fm';

/** There is one switch on the page, so its hint has a fixed id. */
const HINT_ID = 'fm-switch-hint';

/**
 * The one big switch. "Off" and "On" are written on it as well as shown by the knob. When it cannot be switched on it stays
 * reachable by keyboard and screen reader (aria-disabled, not disabled) so the reason under it can be read.
 */
export function PowerSwitch({ view, busy, onPress }: { view: SwitchView; busy: boolean; onPress(): void }) {
  const inert = view.disabled || busy;
  return (
    <div className="fm-power">
      <button type="button" role="switch" className="fm-switch" aria-checked={view.checked} aria-disabled={inert} aria-describedby={HINT_ID} data-on={view.checked} data-unavailable={view.disabled} onClick={() => !inert && onPress()}>
        <span className="fm-switch-title">{SWITCH_TITLE}</span>
        <span className="fm-switch-state" aria-hidden="true">
          {view.stateWord}
        </span>
        <span className="fm-track" aria-hidden="true">
          <i />
        </span>
      </button>
      <p className="fm-hint" id={HINT_ID}>
        {view.hint}
      </p>
    </div>
  );
}
