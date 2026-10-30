import type { LyricLine, LyricsResult } from '@headunit/shared';
import type { NowPlayingView } from './nowPlaying';

/**
 * Which line is being sung at `ms`: the last one whose time has come, or -1 before the first. `lead` shows a line a moment early
 * (a singer starts as the line appears, and the progress we have is up to a second old).
 */
export function lyricIndexAt(lines: readonly LyricLine[], ms: number, lead = 250): number {
  const t = ms + lead;
  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** What to ask the lyrics service for, or null when the source has no track to look up (a radio stream). */
export function lyricsQuery(np: NowPlayingView | null): string | null {
  if (!np || np.kind === 'radio' || !np.title || !np.artist) return null;
  const p = new URLSearchParams({ title: np.title, artist: np.artist });
  if (np.album) p.set('album', np.album);
  if (np.durationMs) p.set('duration', String(Math.round(np.durationMs / 1000)));
  return p.toString();
}

export type LyricsView =
  | { kind: 'synced'; lines: LyricLine[] }
  | { kind: 'plain'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'none' };

/** The most useful form of what the service returned: lines that can follow the song, else the text, else the honest "none". */
export function lyricsView(r: LyricsResult | null): LyricsView {
  if (!r) return { kind: 'none' };
  if (r.synced && r.synced.length > 0) return { kind: 'synced', lines: r.synced };
  if (r.instrumental) return { kind: 'instrumental' };
  if (r.plain) return { kind: 'plain', text: r.plain };
  return { kind: 'none' };
}
