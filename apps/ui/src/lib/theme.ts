import { isNightAt, type Settings, type ThemeId } from '@headunit/shared';

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Is `now` inside the night window? The window may wrap past midnight (19:00 → 06:30). */
export function isNight(now: Date, nightStart: string, nightEnd: string): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const start = minutes(nightStart);
  const end = minutes(nightEnd);
  if (start === end) return false; // zero-length window: never night
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export interface Place {
  lat: number;
  lon: number;
}

/**
 * The palette to show now. With automatic day/night on, it follows the clock times in Settings, or, in `sun` mode and when the
 * car's position is known, the real sunrise and sunset there (worked out offline). With no position the clock times still apply,
 * so the choice is never silently ignored.
 */
export function effectiveTheme(
  s: Pick<Settings, 'theme' | 'autoTheme' | 'dayTheme' | 'nightTheme' | 'nightStart' | 'nightEnd'> & Partial<Pick<Settings, 'autoThemeMode'>>,
  now: Date,
  place?: Place | null,
): ThemeId {
  if (!s.autoTheme) return s.theme;
  const night = s.autoThemeMode === 'sun' && place ? isNightAt(now, place.lat, place.lon) : isNight(now, s.nightStart, s.nightEnd);
  return night ? s.nightTheme : s.dayTheme;
}

/** Step an "HH:MM" time by `deltaMin` minutes, wrapping around the clock. */
export function stepTime(hhmm: string, deltaMin: number): string {
  const total = (((minutes(hhmm) + deltaMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
