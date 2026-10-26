import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../lib/clipboard';

/** "Copy" that turns into "Copied" for a moment. If the browser refuses, it says so and the text can still be selected by hand. */
export function CopyButton({ text, label = 'Copy', what }: { text: string; label?: string; what?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2200);
  };

  return (
    <button type="button" className="btn small copy-btn" data-state={state} onClick={() => void copy()} aria-label={what ? `${label} ${what}` : label}>
      {state === 'copied' ? <Check size={16} /> : <Copy size={16} />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it, then copy' : label}</span>
    </button>
  );
}
