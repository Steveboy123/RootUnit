import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useHeadUnit } from '../store';

/**
 * Universal prev / play-pause / next. An explicit `source` pins the server's music or the radio; otherwise it follows what is actually
 * audible: radio, a browser-local TIDAL/YouTube player, Bluetooth AVRCP, then the server's music provider.
 */
export function Transport({ className = '', source, size = 'md' }: { className?: string; source?: 'media' | 'radio'; size?: 'sm' | 'md' | 'lg' }) {
  const radio = useHeadUnit((s) => s.radio);
  const media = useHeadUnit((s) => s.media);
  const local = useHeadUnit((s) => s.localNowPlaying);
  const bt = useHeadUnit((s) => s.devices?.media);
  const mediaCmd = useHeadUnit((s) => s.media_cmd);
  const radioCmd = useHeadUnit((s) => s.radio_cmd);
  const localCmd = useHeadUnit((s) => s.localMedia_cmd);
  const deviceCmd = useHeadUnit((s) => s.device_cmd);

  type Src = 'media' | 'radio' | 'local' | 'bluetooth';
  let src: Src;
  if (source) src = source;
  else if (radio?.playing) src = 'radio';
  else if (local) src = 'local';
  else if (bt && (bt.status === 'playing' || (!media?.playing && bt.status === 'paused')) && (bt.title || bt.artist)) src = 'bluetooth';
  else src = 'media';

  const playing = src === 'radio' ? Boolean(radio?.playing) : src === 'local' ? Boolean(local?.playing) : src === 'bluetooth' ? bt?.status === 'playing' : Boolean(media?.playing);
  const send = (action: 'toggle' | 'next' | 'prev') => {
    if (src === 'radio') radioCmd({ cmd: action });
    else if (src === 'local') localCmd(action);
    else if (src === 'bluetooth') deviceCmd({ cmd: 'media', action });
    else mediaCmd({ cmd: action });
  };
  const noun = src === 'radio' ? 'station' : 'track';

  return (
    <div className={`transport ${className}`} data-size={size} data-no-swipe>
      <button type="button" className="tp-btn" aria-label={`Previous ${noun}`} onClick={() => send('prev')}>
        <SkipBack fill="currentColor" />
      </button>
      <button type="button" className="tp-btn tp-main" data-playing={playing} aria-label={playing ? 'Pause' : 'Play'} onClick={() => send('toggle')}>
        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <button type="button" className="tp-btn" aria-label={`Next ${noun}`} onClick={() => send('next')}>
        <SkipForward fill="currentColor" />
      </button>
    </div>
  );
}
