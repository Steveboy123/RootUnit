import { useEffect, useRef, useState } from 'react';
import { useHeadUnit } from '../store';

/**
 * The radio's actual speaker. The server proxies the station (stripping ICY metadata) from a
 * same-origin URL, so a plain <audio> element can play it with no CORS trouble. The element is
 * driven entirely by server state, and reconnects with backoff if the stream drops.
 */
export function RadioPlayer() {
  const radio = useHeadUnit((s) => s.radio);
  const audio = useRef<HTMLAudioElement>(null);
  const failures = useRef(0);
  const [retry, setRetry] = useState(0);

  const src = radio?.playing && radio.stationId ? `/api/radio/stream/${encodeURIComponent(radio.stationId)}?s=${radio.session}&r=${retry}` : null;

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (src) {
      if (a.dataset.src !== src) {
        a.dataset.src = src;
        a.src = src;
      }
      a.play().catch(() => {
        /* autoplay refused: the kiosk flag allows it; in a normal browser the first tap unlocks it */
      });
    } else {
      a.pause();
      a.removeAttribute('src');
      delete a.dataset.src;
      a.load();
      failures.current = 0;
    }
  }, [src]);

  // A live stream should never end or error; if it does, try again (1.5 s, 3 s, … max 10 s).
  useEffect(() => {
    const a = audio.current;
    if (!a || !src) return;
    let timer: number | undefined;
    const fail = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRetry((r) => r + 1), Math.min(10_000, 1500 * 2 ** failures.current++));
    };
    const ok = () => (failures.current = 0);
    a.addEventListener('error', fail);
    a.addEventListener('ended', fail);
    a.addEventListener('playing', ok);
    return () => {
      window.clearTimeout(timer);
      a.removeEventListener('error', fail);
      a.removeEventListener('ended', fail);
      a.removeEventListener('playing', ok);
    };
  }, [src]);

  return <audio ref={audio} preload="none" data-testid="radio-audio" />;
}
