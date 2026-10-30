import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LOOK_KEYS,
  SAVED_LOOK_LIMITS,
  cleanLookName,
  lookFromUntrusted,
  lookOf,
  mergeSettings,
  sanitizeSavedLooks,
  type Settings,
} from '@headunit/shared';

const look = (over: Partial<Settings> = {}) => ({ ...lookOf(DEFAULT_SETTINGS), ...over });
const saved = (id: string, name = id, over: Partial<Settings> = {}) => ({ id, name, look: look(over) });

describe('My looks: what is kept', () => {
  it('keeps a valid list as it is', () => {
    const list = [saved('night', 'Night drive', { theme: 'neonoir', surface: 'holo' }), saved('day', 'Day', { theme: 'paper' })];
    expect(sanitizeSavedLooks(list)).toEqual(list);
  });

  it('a look holds exactly the look settings: no units, no navigation, no saved looks inside it', () => {
    const v = lookFromUntrusted({ ...DEFAULT_SETTINGS, theme: 'miami', units: 'imperial', nav: { version: 1 }, myLooks: [saved('x')] });
    expect(Object.keys(v).sort()).toEqual([...LOOK_KEYS].sort());
    expect(v.theme).toBe('miami');
    expect(v).not.toHaveProperty('units');
    expect(v).not.toHaveProperty('myLooks');
  });

  it('checks each look setting like any setting and fills the rest from the defaults', () => {
    const v = lookFromUntrusted({ theme: 'nope', surface: 'brutal', accent: '#ABCDEF', mascotSize: 999, transition: 'portal' });
    expect(v).toEqual(look({ surface: 'brutal', accent: '#abcdef', mascotSize: 95, transition: 'portal' }));
    expect(lookFromUntrusted('a string')).toEqual(look());
    expect(lookFromUntrusted(null)).toEqual(look());
  });

  it('drops entries with a bad id, a repeated id, no name or no look', () => {
    const out = sanitizeSavedLooks([
      saved('ok'),
      saved('ok', 'second with the same id'),
      saved('Bad Id'),
      saved('-starts-with-dash'),
      { id: 'no-look', name: 'x' },
      { id: 'empty-name', name: '   ', look: look() },
      { id: 'not-a-name', name: 42, look: look() },
      'not an object',
      null,
    ]);
    expect(out.map((l) => l.id)).toEqual(['ok']);
    expect(out[0]!.name).toBe('ok');
  });

  it('cleans names: no control characters, no runs of space, at most the limit', () => {
    expect(cleanLookName('  Night\t\n  drive  ')).toBe('Night drive');
    expect(cleanLookName('a'.repeat(60))).toHaveLength(SAVED_LOOK_LIMITS.name);
    expect(cleanLookName(`x${String.fromCharCode(0x2028)}y`)).toBe('x y');
    expect(cleanLookName(undefined)).toBe('');
  });

  it(`keeps at most ${SAVED_LOOK_LIMITS.count}, and does not read an endless list`, () => {
    const many = Array.from({ length: 5000 }, (_, i) => saved(`look-${i}`));
    const started = Date.now();
    const out = sanitizeSavedLooks(many);
    expect(out).toHaveLength(SAVED_LOOK_LIMITS.count);
    expect(out[0]!.id).toBe('look-0');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('arrives through mergeSettings, and anything that is not a list leaves them alone', () => {
    const withOne = mergeSettings(DEFAULT_SETTINGS, { myLooks: [saved('a', 'A', { theme: 'toxic' })] });
    expect(withOne.myLooks).toHaveLength(1);
    expect(mergeSettings(withOne, { myLooks: 'clear' }).myLooks).toHaveLength(1);
    expect(mergeSettings(withOne, { myLooks: [] }).myLooks).toEqual([]);
  });
});
