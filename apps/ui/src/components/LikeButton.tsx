import { useState } from 'react';
import { Heart } from 'lucide-react';
import { apiSend } from '../lib/api';
import { providerLabel } from '../lib/connections';
import { useHeadUnit } from '../store';

/** ♥ for the current track. Its state comes from the server, so it stays right however the track was liked. */
export function LikeButton({ className = '' }: { className?: string }) {
  const track = useHeadUnit((s) => s.media?.track);
  const liked = useHeadUnit((s) => s.media?.liked);
  const provider = useHeadUnit((s) => s.media?.provider);
  const toast = useHeadUnit((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  if (!track?.uri) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const r = await apiSend<{ liked: boolean }>('/api/library/like', { uri: track.uri, on: liked !== true });
    setBusy(false);
    if (r.error) toast(r.error.code === 'scope' ? `Reconnect ${providerLabel(provider)} (Settings) to like songs` : r.error.message);
    else toast(r.data?.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  };

  return (
    <button type="button" className={`icon-btn like ${className}`} data-on={liked === true} aria-pressed={liked === true} aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'} disabled={busy} onClick={toggle} data-no-swipe>
      <Heart fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}
