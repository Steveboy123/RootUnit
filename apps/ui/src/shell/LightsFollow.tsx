import { useEffect, useRef } from 'react';
import { followColor } from '../lib/lights';
import { useHeadUnit, useSvc } from '../store';

/**
 * Lights → "Match the screen": the WLED lights take the accent the interface is drawn in (the album's colour while the accent follows
 * the album art). Sends after the colour has settled for a moment, so a run of track changes sends one colour, not a burst.
 */
export function LightsFollow({ accent }: { accent: string }) {
  const on = useHeadUnit((s) => s.settings?.lightsFollowAccent ?? false);
  const lights = useSvc('lighting');
  const lastSent = useRef('');
  const hex = followColor({ on, lights, accent, lastSent: lastSent.current });
  useEffect(() => {
    if (!on) lastSent.current = '';
    if (!hex) return;
    const timer = window.setTimeout(() => {
      lastSent.current = hex;
      void fetch('/api/lighting/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: hex }) }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [hex, on]);
  return null;
}
