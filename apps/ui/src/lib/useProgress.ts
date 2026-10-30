import type { MediaState } from '@headunit/shared';
import { clamp } from './format';
import { useFrameTime } from './hooks';

/** Smoothly interpolated playback position (ms) between server updates. */
export function useProgressMs(media: MediaState | null): number {
  const t = useFrameTime(Boolean(media?.playing));
  if (!media) return 0;
  const dur = media.track?.durationMs ?? 0;
  const elapsed = media.playing ? Math.max(0, Math.max(t, media.progressTs) - media.progressTs) : 0;
  return clamp(media.progressMs + elapsed, 0, dur > 0 ? dur : Number.MAX_SAFE_INTEGER);
}
