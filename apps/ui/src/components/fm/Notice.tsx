import { useEffect, useRef } from 'react';
import { FM_NOTICE_POINTS } from '@headunit/shared';
import { Sheet } from '../ui';

/**
 * The notice a person reads before anything transmits. Nothing here accepts it for them: the sheet closing, Escape and a tap outside
 * all mean "not now". Focus moves in when it opens and goes back to the switch when it closes.
 */
export function FmNotice({ busy, onAccept, onCancel }: { busy: boolean; onAccept(): void; onCancel(): void }) {
  const lead = useRef<HTMLParagraphElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const working = useRef(busy);
  working.current = busy;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lead.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working.current) cancel.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <Sheet title="Before you switch it on" onClose={onCancel}>
      <div className="fm-notice">
        <p className="fm-lead" ref={lead} tabIndex={-1}>
          Please read this. It is asked again only if the notice changes.
        </p>
        <ul className="fm-notice-points">
          {FM_NOTICE_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="fm-note">Tapping “I understand” saves that you have read this, and switches the transmitter on.</p>
        <div className="fm-notice-actions">
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Not now
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={onAccept}>
            I understand
          </button>
        </div>
      </div>
    </Sheet>
  );
}
