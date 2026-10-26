/** A month as weeks of days for the calendar widget: Monday first, with the days of the months either side filling the first and last week. */
export interface CalendarDay {
  day: number;
  inMonth: boolean;
  today: boolean;
}

export function monthGrid(year: number, month: number, today: Date): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - lead);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const out: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      row.push({ day: date.getDate(), inMonth: date.getMonth() === month, today: date.toDateString() === today.toDateString() });
    }
    out.push(row);
  }
  return out;
}

/** The ISO week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
