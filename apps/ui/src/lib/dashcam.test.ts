import { describe, expect, it } from 'vitest';
import { clipStart, eventTitle } from './dashcam';

describe('clipStart', () => {
  it('reads the local start time out of the file name', () => {
    const d = clipStart('dash-20260603-091207.mkv')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2026, 5, 3, 9, 12, 7]);
  });
  it('is null for names the recorder does not write', () => {
    for (const n of ['', 'dash.mkv', 'dash-20260603-091207.mp4', 'event-1700000000000-motion.mkv', '../dash-20260603-091207.mkv', 'dash-20260603-091207.mkv.tmp']) expect(clipStart(n), n).toBeNull();
  });
  it('is null for a time that does not exist rather than quietly rolling over', () => {
    expect(clipStart('dash-20260231-091207.mkv')).toBeNull(); // 31 February
    expect(clipStart('dash-20261301-091207.mkv')).toBeNull(); // month 13
    expect(clipStart('dash-20260603-251207.mkv')).toBeNull(); // 25:12
  });
});

describe('eventTitle', () => {
  it('uses plain words for the known kinds and shows an unknown one as it is', () => {
    expect(eventTitle('impact')).toBe('Impact');
    expect(eventTitle('manual')).toBe('Saved by you');
    expect(eventTitle('glass-break')).toBe('glass-break');
  });
});
