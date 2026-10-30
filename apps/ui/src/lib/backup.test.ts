import { describe, expect, it } from 'vitest';
import { describeRestore, fileSize, partName } from './backup';

describe('describeRestore', () => {
  it('names what came back, in plain words', () => {
    expect(describeRestore({ restored: ['settings', 'garage', 'radio'], skipped: [] })).toEqual({
      summary: 'Restored Settings, Garage and Radio stations.',
      problems: [],
      ok: true,
    });
    expect(describeRestore({ restored: ['trips'], skipped: [] }).summary).toBe('Restored Trips.');
  });
  it('reports what could not be restored with the reason, and is not "ok"', () => {
    const r = describeRestore({ restored: ['notes'], skipped: [{ part: 'layout', reason: 'The dashboard layout in the backup is damaged.' }] });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['Dashboard layout: The dashboard layout in the backup is damaged.']);
    expect(r.summary).toBe('Restored Notes.');
  });
  it('says plainly when nothing was restored', () => {
    expect(describeRestore({ restored: [], skipped: [] })).toMatchObject({ summary: 'Nothing was restored.', ok: false });
  });
  it('shows an unknown part by its own name', () => expect(partName('future-thing')).toBe('future-thing'));
});

describe('fileSize', () => {
  it('uses the unit that reads best', () => {
    expect(fileSize(0)).toBe('0 B');
    expect(fileSize(900)).toBe('900 B');
    expect(fileSize(12 * 1024)).toBe('12 KB');
    expect(fileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
  it('is empty for nonsense', () => {
    expect(fileSize(-1)).toBe('');
    expect(fileSize(Number.NaN)).toBe('');
  });
});
