import { describe, expect, it } from 'vitest';
import { displayModeOf, displayModePatch } from './displayMode';

const s = { autoTheme: false, theme: 'midnight' as const, dayTheme: 'daylight' as const, nightTheme: 'midnight' as const };

describe('display mode', () => {
  it('reads the mode back from the settings', () => {
    expect(displayModeOf({ ...s, autoTheme: true })).toBe('auto');
    expect(displayModeOf({ ...s, theme: 'midnight' })).toBe('night');
    expect(displayModeOf({ ...s, theme: 'daylight' })).toBe('day');
    expect(displayModeOf({ ...s, theme: 'ember' })).toBe('custom');
  });
  it('auto wins over a leftover theme', () => {
    expect(displayModeOf({ ...s, autoTheme: true, theme: 'ember' })).toBe('auto');
  });
  it('makes each choice true again', () => {
    for (const mode of ['auto', 'day', 'night'] as const) {
      const next = { ...s, ...displayModePatch(mode, s) };
      expect(displayModeOf(next)).toBe(mode);
    }
    expect(displayModePatch('night', s)).toEqual({ autoTheme: false, theme: 'midnight' });
    expect(displayModePatch('day', s)).toEqual({ autoTheme: false, theme: 'daylight' });
    expect(displayModePatch('auto', s)).toEqual({ autoTheme: true });
  });
  it('when the day and night looks are the same, "night" is what it reads as', () => {
    const same = { ...s, dayTheme: 'carbon' as const, nightTheme: 'carbon' as const, theme: 'carbon' as const };
    expect(displayModeOf(same)).toBe('night');
  });
});
