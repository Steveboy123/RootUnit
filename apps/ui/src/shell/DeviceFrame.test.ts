import { describe, expect, it } from 'vitest';
import { frameChoice } from './DeviceFrame';

describe('preview frame size', () => {
  it('a bare ?frame shows the frame at the size used last time, or 1024×600 the first time', () => {
    expect(frameChoice('?frame', null)).toBe('1024x600');
    expect(frameChoice('?frame', '1280x400')).toBe('1280x400');
  });
  it('?frame=<size> picks that size; an unknown size falls back', () => {
    expect(frameChoice('?frame=800x480', '1280x400')).toBe('800x480');
    expect(frameChoice('?frame=huge', '1280x400')).toBe('1280x400');
    expect(frameChoice('', 'not-a-size')).toBe('1024x600');
  });
});
