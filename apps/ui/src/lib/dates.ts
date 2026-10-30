/** Calendar dates as `YYYY-MM-DD` strings: no times, no time zones, so a date never shifts when the clock does. */

export interface YMD {
  y: number;
  m: number;
  d: number;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const toIso = ({ y, m, d }: YMD) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;

export function parseIso(iso: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return toIso(ymd) === iso && ymd.m >= 1 && ymd.m <= 12 && ymd.d >= 1 && ymd.d <= daysInMonth(ymd.y, ymd.m) ? ymd : null;
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function todayIso(now: Date = new Date()): string {
  return toIso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** A date with one part changed, keeping the day inside the month (31 Jan, move to February: 28 or 29 Feb). */
export function withPart(iso: string, part: 'y' | 'm' | 'd', value: number): string {
  const cur = parseIso(iso) ?? parseIso(todayIso())!;
  const next = { ...cur, [part]: value };
  next.y = Math.min(2100, Math.max(1990, next.y));
  next.m = Math.min(12, Math.max(1, next.m));
  next.d = Math.min(daysInMonth(next.y, next.m), Math.max(1, next.d));
  return toIso(next);
}

/** `iso` plus whole months, clamped to the end of a shorter month. */
export function addMonthsIso(iso: string, months: number): string {
  const cur = parseIso(iso) ?? parseIso(todayIso())!;
  const t = new Date(Date.UTC(cur.y, cur.m - 1 + months, 1));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  return toIso({ y, m, d: Math.min(cur.d, daysInMonth(y, m)) });
}

export function addDaysIso(iso: string, days: number): string {
  const cur = parseIso(iso) ?? parseIso(todayIso())!;
  const t = new Date(Date.UTC(cur.y, cur.m - 1, cur.d + days));
  return toIso({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

export const daysBetweenIso = (a: string, b: string): number => {
  const x = parseIso(a);
  const y = parseIso(b);
  if (!x || !y) return 0;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86_400_000);
};

/** "19 Jun 2024" in the browser's language. */
export function formatDate(iso: string, locale?: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "19 Jun": a date without its year, for chart axes and short lists. */
export function formatDateShort(iso: string, locale?: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "today 14:05", "yesterday 08:30", or "Mon 3 Jun 09:12": enough to find a moment without reading a date. */
export function whenText(at: Date, nowMs: number, locale?: string): string {
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(nowMs) - startOfDay(at.getTime())) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  return `${at.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
