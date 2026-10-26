import { describe, expect, it } from 'vitest';
import { keyDir, swipeDir } from './swipe';

describe('swipeDir', () => {
  it('reads the four directions', () => {
    expect(swipeDir(60, 5)).toBe('right');
    expect(swipeDir(-60, -5)).toBe('left');
    expect(swipeDir(4, 60)).toBe('down');
    expect(swipeDir(-4, -60)).toBe('up');
  });
  it('lets the longer axis win, and a tie goes sideways', () => {
    expect(swipeDir(40, 50)).toBe('down');
    expect(swipeDir(50, 40)).toBe('right');
    expect(swipeDir(40, 40)).toBe('right');
  });
  it('ignores a tap or a wobble', () => {
    expect(swipeDir(0, 0)).toBeNull();
    expect(swipeDir(27, 27)).toBeNull();
    expect(swipeDir(28, 0)).toBe('right');
  });
});

describe('keyDir', () => {
  it('maps arrows and WASD', () => {
    expect(keyDir({ key: 'ArrowUp' })).toBe('up');
    expect(keyDir({ key: 'a' })).toBe('left');
    expect(keyDir({ key: 'S' })).toBe('down');
    expect(keyDir({ key: 'ArrowRight' })).toBe('right');
  });
  it('leaves browser shortcuts and other keys alone', () => {
    expect(keyDir({ key: 'a', ctrlKey: true })).toBeNull(); // select all
    expect(keyDir({ key: 'd', metaKey: true })).toBeNull();
    expect(keyDir({ key: 'ArrowLeft', altKey: true })).toBeNull(); // browser back
    expect(keyDir({ key: 'Enter' })).toBeNull();
  });
});
