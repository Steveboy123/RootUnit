/** The recorder writes `dash-YYYYMMDD-HHMMSS.mkv`, named by the Pi's local clock. This is its start time, or null for any other name. */
export function clipStart(name: string): Date | null {
  const m = /^dash-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.mkv$/.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  // new Date rolls 31 February over into March: a name like that is not a real time.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) return null;
  return date;
}

const EVENT_TITLES: Record<string, string> = {
  manual: 'Saved by you',
  motion: 'Movement',
  impact: 'Impact',
  door: 'Door opened',
  alarm: 'Alarm',
};

/** Plain words for what triggered a saved moment. An unknown kind is shown as it is rather than hidden. */
export const eventTitle = (kind: string) => EVENT_TITLES[kind] ?? kind;
