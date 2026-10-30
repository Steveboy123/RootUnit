import { describe, expect, it } from 'vitest';
import { NAV_HINT_KEY, takeNavHint, type HintStorage } from './hint';

const memory = (seed: Record<string, string> = {}): HintStorage & { data: Record<string, string> } => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k]! : null), setItem: (k, v) => void (data[k] = v) };
};

describe('takeNavHint', () => {
  it('is true the first time and remembers it', () => {
    const s = memory();
    expect(takeNavHint(s)).toBe(true);
    expect(s.data[NAV_HINT_KEY]).toBe('1');
    expect(takeNavHint(s)).toBe(false);
    expect(takeNavHint(s)).toBe(false);
  });

  it('is false when it was shown before', () => {
    expect(takeNavHint(memory({ [NAV_HINT_KEY]: '1' }))).toBe(false);
  });

  it('is false without storage, and when the storage throws (it could not be remembered, so it is not shown)', () => {
    expect(takeNavHint(null)).toBe(false);
    expect(takeNavHint({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBe(false);
    expect(takeNavHint({ getItem: () => null, setItem: () => { throw new Error('full'); } })).toBe(false);
  });
});
