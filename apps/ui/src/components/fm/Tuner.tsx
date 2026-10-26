import type { TunerView } from '../../lib/fm';

/** The frequency in big figures, with the four buttons that move it. The 0.1 buttons are the wide ones: that is the step you use most. */
export function Tuner({ view, pending, onStep }: { view: TunerView; pending: boolean; onStep(steps: number): void }) {
  return (
    <div className="fm-tuner">
      {/* An <output> is a live region: a screen reader hears the new frequency after each tap. */}
      <output className="fm-readout" aria-live="polite" data-pending={pending}>
        <span className="fm-freq">{view.text}</span> <span className="fm-unit">MHz</span>
      </output>
      <div className="fm-steps" role="group" aria-label="Tune the frequency">
        {view.buttons.map((b) => (
          <button key={b.steps} type="button" className="fm-step" data-main={Math.abs(b.steps) === 1} aria-label={b.aria} disabled={b.disabled} onClick={() => onStep(b.steps)}>
            {b.label}
          </button>
        ))}
      </div>
      <p className="fm-note">{view.range}</p>
    </div>
  );
}
