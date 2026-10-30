import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FM_DEFAULT_FREQUENCY } from '@headunit/shared';
import { JsonStore } from '../store';
import { DEFAULT_FM_FILE, FM_FILE, sanitizeFmFile } from './store';

describe('sanitizeFmFile', () => {
  it('keeps a good file as it is', () => {
    const f = { version: 1, frequency: 100.6, on: true, presets: [88.1, 100.6], ack: { version: 1, at: 1_700_000_000_000 } };
    expect(sanitizeFmFile(f)).toEqual(f);
  });

  it('junk of every kind becomes the defaults, and never throws', () => {
    for (const junk of [undefined, null, 'x', 7, true, [], [1, 2], {}, Object.create(null), () => 1]) {
      expect(sanitizeFmFile(junk)).toEqual(DEFAULT_FM_FILE);
    }
    const hostile = { get frequency(): never { throw new Error('boom'); } };
    expect(sanitizeFmFile(hostile)).toEqual(DEFAULT_FM_FILE);
  });

  it('checks each field on its own: one bad field does not cost the others', () => {
    const f = sanitizeFmFile({ frequency: 'loud', on: 'yes', presets: [100.64, 5, 'x', 100.6], ack: { version: '1', at: 5 } });
    expect(f).toEqual({ version: 1, frequency: FM_DEFAULT_FREQUENCY, on: false, presets: [100.6], ack: null });
    expect(sanitizeFmFile({ frequency: 200, on: true }).frequency).toBe(FM_DEFAULT_FREQUENCY);
    expect(sanitizeFmFile({ frequency: 87.4 }).frequency).toBe(FM_DEFAULT_FREQUENCY);
    expect(sanitizeFmFile({ frequency: 99.96 }).frequency).toBe(100);
    expect(sanitizeFmFile({ frequency: NaN }).frequency).toBe(FM_DEFAULT_FREQUENCY);
  });

  it('only true means on', () => {
    for (const v of [1, 'true', {}, [], null]) expect(sanitizeFmFile({ on: v }).on).toBe(false);
    expect(sanitizeFmFile({ on: true }).on).toBe(true);
  });

  it('the acknowledgement needs a whole version of 1 or more and a time', () => {
    for (const ack of [{ version: 0, at: 1 }, { version: 1.5, at: 1 }, { version: -1, at: 1 }, { version: 1, at: -1 }, { version: 1, at: NaN }, { version: 1 }, { at: 1 }, 1, 'x', [], null]) {
      expect(sanitizeFmFile({ ack }).ack, JSON.stringify(ack)).toBeNull();
    }
    expect(sanitizeFmFile({ ack: { version: 3, at: 0 } }).ack).toEqual({ version: 3, at: 0 });
  });

  it('presets: capped, unique, in the band', () => {
    expect(sanitizeFmFile({ presets: Array.from({ length: 40 }, (_, i) => 88 + i * 0.5) }).presets).toHaveLength(6);
    expect(sanitizeFmFile({ presets: [90, 90, 90] }).presets).toEqual([90]);
    expect(sanitizeFmFile({ presets: 'x' }).presets).toEqual([]);
  });

  it('a file never holds anything but these fields (no password can ride along)', () => {
    const f = sanitizeFmFile({ frequency: 90, token: 'SECRET', FM_NODE_TOKEN: 'SECRET', nested: { token: 'SECRET' } });
    expect(JSON.stringify(f)).not.toContain('SECRET');
    expect(Object.keys(f).sort()).toEqual(['ack', 'frequency', 'on', 'presets', 'version']);
  });
});

describe('data/fm.json on disk', () => {
  let dir: string;
  let store: JsonStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fm-store-'));
    store = new JsonStore(dir);
  });
  afterEach(async () => {
    await store.flush();
    await rm(dir, { recursive: true, force: true });
  });

  it('a file that is not JSON reads as the defaults', async () => {
    await writeFile(join(dir, FM_FILE), '{not json');
    expect(sanitizeFmFile(await store.read(FM_FILE))).toEqual(DEFAULT_FM_FILE);
  });

  it('what was written is what is read back', async () => {
    await store.write(FM_FILE, { version: 1, frequency: 95.5, on: false, presets: [95.5], ack: null });
    await store.flush();
    expect(sanitizeFmFile(await store.read(FM_FILE)).presets).toEqual([95.5]);
  });
});
