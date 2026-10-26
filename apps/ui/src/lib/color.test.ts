import { describe, expect, it } from 'vitest';
import { hexToRgb, onColor } from './color';

describe('color', () => {
  it('parses hex and falls back safely', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('nope')).toEqual([61, 213, 243]);
  });
  it('picks readable text for light and dark accents', () => {
    expect(onColor('#fbbf24')).toBe('#06121a'); // amber → dark text
    expect(onColor('#3dd5f3')).toBe('#06121a'); // cyan → dark text
    expect(onColor('#1e3a8a')).toBe('#ffffff'); // navy → white text
  });
});
