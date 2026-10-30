import { describe, expect, it } from 'vitest';
import { readBest, recordBest } from './best';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('best scores', () => {
  it('starts at zero', () => expect(readBest('2048', memory())).toBe(0));
  it('keeps a higher score and ignores a lower or equal one', () => {
    const s = memory();
    expect(recordBest('2048', 500, s)).toBe(500);
    expect(recordBest('2048', 300, s)).toBe(500);
    expect(recordBest('2048', 500, s)).toBe(500);
    expect(recordBest('2048', 640, s)).toBe(640);
    expect(readBest('2048', s)).toBe(640);
  });
  it('keeps each game apart', () => {
    const s = memory();
    recordBest('2048', 100, s);
    expect(readBest('snake', s)).toBe(0);
  });
  it('treats junk in storage as no score', () => {
    const s = memory();
    s.setItem('hu.arcade.best.snake', 'abc');
    expect(readBest('snake', s)).toBe(0);
    s.setItem('hu.arcade.best.snake', '-5');
    expect(readBest('snake', s)).toBe(0);
  });
  it('still works when storage throws (private window, blocked data)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readBest('2048', broken)).toBe(0);
    expect(recordBest('2048', 90, broken)).toBe(90); // not saved, but it is still the best of this session
  });
  it('works with no storage at all', () => {
    expect(readBest('2048', null)).toBe(0);
    expect(recordBest('2048', 10, null)).toBe(10);
  });
});
