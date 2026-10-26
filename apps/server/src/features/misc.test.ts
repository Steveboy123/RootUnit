import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonStore } from '../store';
import { DocStore, cleanDoc, isDocName } from './docs';
import { LyricsService, parseLrc, sanitizeLyricsQuery } from './lyrics';
import { NoteError, NotesService } from './notes';
import { DEFAULT_SCENES, SceneError, ScenesService } from './scenes';

let dir: string;
let store: JsonStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'misc-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  await store.flush();
  await rm(dir, { recursive: true, force: true });
});

describe('parseLrc', () => {
  it('reads timed lines in order', () => {
    expect(parseLrc('[00:12.00] First line\n[00:05.50]Zeroth line\n[01:02.345]Later')).toEqual([
      { t: 5500, text: 'Zeroth line' },
      { t: 12000, text: 'First line' },
      { t: 62345, text: 'Later' },
    ]);
  });

  it('handles a stamp without hundredths, one with two digits, and the colon variant', () => {
    expect(parseLrc('[00:07] a\n[00:08.5] b\n[00:09:25] c')).toEqual([
      { t: 7000, text: 'a' },
      { t: 8500, text: 'b' },
      { t: 9250, text: 'c' },
    ]);
  });

  it('gives a repeated chorus one line per stamp', () => {
    expect(parseLrc('[00:10.00][00:50.00][01:30.00]Sing along')).toEqual([
      { t: 10000, text: 'Sing along' },
      { t: 50000, text: 'Sing along' },
      { t: 90000, text: 'Sing along' },
    ]);
  });

  it('keeps empty lines as rests, ignores tags, and copes with Windows line endings', () => {
    const lines = parseLrc('[ar:Someone]\r\n[ti:A song]\r\n[00:01.00]Hi\r\n[00:05.00]\r\n[00:09.00]Bye\r\n');
    expect(lines).toEqual([
      { t: 1000, text: 'Hi' },
      { t: 5000, text: '' },
      { t: 9000, text: 'Bye' },
    ]);
  });

  it('applies the offset header (positive = lines appear earlier) and never goes below zero', () => {
    expect(parseLrc('[offset:+500]\n[00:02.00]a\n[00:00.20]b')).toEqual([
      { t: 0, text: 'b' },
      { t: 1500, text: 'a' },
    ]);
    expect(parseLrc('[offset:-1000]\n[00:02.00]a')).toEqual([{ t: 3000, text: 'a' }]);
  });

  it('is empty for plain text, nothing and garbage', () => {
    expect(parseLrc('Just some words\nno times')).toEqual([]);
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc('[xx:yy]nope')).toEqual([]);
  });

  it('is bounded: a hostile file cannot make millions of lines', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.00]line ${i}`).join('\n');
    expect(parseLrc(huge).length).toBeLessThanOrEqual(1500);
  });
});

describe('sanitizeLyricsQuery', () => {
  it('needs a title and an artist, trims, and bounds everything', () => {
    expect(sanitizeLyricsQuery({ title: '  Song ', artist: 'Band', album: 'LP', duration: '215.4' })).toEqual({ title: 'Song', artist: 'Band', album: 'LP', durationS: 215 });
    expect(sanitizeLyricsQuery({ title: 'Song' })).toBeNull();
    expect(sanitizeLyricsQuery({ artist: 'Band' })).toBeNull();
    expect(sanitizeLyricsQuery({ title: 'x'.repeat(500), artist: 'y' })!.title).toHaveLength(120);
    expect(sanitizeLyricsQuery({ title: 'a', artist: 'b', duration: '-5' })).toEqual({ title: 'a', artist: 'b' });
    expect(sanitizeLyricsQuery({ title: 'a', artist: 'b', duration: 'forever' })).toEqual({ title: 'a', artist: 'b' });
  });
});

describe('LyricsService', () => {
  const rec = (over = {}) => ({ trackName: 'Song', artistName: 'Band', duration: 215, instrumental: false, plainLyrics: 'la la', syncedLyrics: '[00:01.00]la la', ...over });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('finds synced lyrics with the exact lookup', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(rec()));
    const l = new LyricsService(f as unknown as typeof fetch);
    const r = await l.get({ title: 'Song', artist: 'Band', album: 'LP', durationS: 215 });
    expect(r).toEqual({ synced: [{ t: 1000, text: 'la la' }], plain: 'la la', instrumental: false });
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain('https://lrclib.net/api/get?');
    expect(url).toContain('track_name=Song');
    expect(url).toContain('duration=215');
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'User-Agent': expect.stringContaining('RPI-Head-Unit') });
  });

  it('falls back to a search when the exact lookup finds nothing, and prefers synced lyrics within a few seconds of the length', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/get?')) return json({ code: 404 }, 404);
      return json([rec({ duration: 300, syncedLyrics: '[00:01.00]wrong length' }), rec({ duration: 217, syncedLyrics: null, plainLyrics: 'plain only' }), rec({ duration: 216, syncedLyrics: '[00:02.00]right one' })]);
    });
    const l = new LyricsService(f as unknown as typeof fetch);
    const r = await l.get({ title: 'Song', artist: 'Band', durationS: 215 });
    expect(r?.synced).toEqual([{ t: 2000, text: 'right one' }]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('answers null when there are none, and remembers that for a while so a car is not hammering the service', async () => {
    let t = 0;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({}, 404));
    const l = new LyricsService(f as unknown as typeof fetch, () => t);
    expect(await l.get({ title: 'Obscure', artist: 'Nobody' })).toBeNull();
    const calls = f.mock.calls.length;
    t += 10 * 60_000;
    expect(await l.get({ title: 'Obscure', artist: 'Nobody' })).toBeNull();
    expect(f.mock.calls.length).toBe(calls);
    t += 60 * 60_000;
    await l.get({ title: 'Obscure', artist: 'Nobody' });
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it('caches hits for a day and treats case as the same track', async () => {
    let t = 0;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(rec()));
    const l = new LyricsService(f as unknown as typeof fetch, () => t);
    await l.get({ title: 'Song', artist: 'Band' });
    await l.get({ title: 'SONG', artist: 'band' });
    expect(f).toHaveBeenCalledTimes(1);
    t += 25 * 3600_000;
    await l.get({ title: 'Song', artist: 'Band' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('marks instrumentals', async () => {
    const l = new LyricsService((async () => json(rec({ instrumental: true, plainLyrics: null, syncedLyrics: null }))) as unknown as typeof fetch);
    expect(await l.get({ title: 'Song', artist: 'Band' })).toEqual({ synced: null, plain: null, instrumental: true });
  });

  it('throws only when the service itself is unreachable, and does not cache that', async () => {
    let fail = true;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => (fail ? json({}, 503) : json(rec())));
    const l = new LyricsService(f as unknown as typeof fetch);
    await expect(l.get({ title: 'Song', artist: 'Band' })).rejects.toThrow('not available');
    fail = false;
    expect((await l.get({ title: 'Song', artist: 'Band' }))?.plain).toBe('la la');
  });

  it('bounds its memory', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json(rec()));
    const l = new LyricsService(f as unknown as typeof fetch);
    for (let i = 0; i < 260; i++) await l.get({ title: `t${i}`, artist: 'a' });
    expect(l['cache'].size).toBeLessThanOrEqual(200);
  });
});

describe('ScenesService', () => {
  const make = () => new ScenesService(store);

  it('seeds the defaults on the very first run and saves them', async () => {
    const s = make();
    await s.start();
    expect(s.state.get().map((x) => x.name)).toEqual(DEFAULT_SCENES.map((x) => x.name));
    await store.flush();
    expect((await store.read('scenes.json')) as { scenes: unknown[] }).toMatchObject({ scenes: expect.any(Array) });
  });

  it('respects an owner who deleted them all: an empty file is not a first run', async () => {
    const s = make();
    await s.start();
    for (const x of s.state.get()) await s.remove(x.id);
    await store.flush();
    const again = make();
    await again.start();
    expect(again.state.get()).toEqual([]);
  });

  it('adds, edits and removes, validating everything', async () => {
    const s = make();
    await s.start();
    const before = s.state.get().length;
    const a = await s.save({ name: 'Camping', icon: 'mountain', actions: { brightness: 20, volume: 30, lights: { enabled: true, color: '#FF8800' }, go: 'media', theme: 'ember' } });
    expect(a.actions.lights).toEqual({ enabled: true, color: '#ff8800' });
    expect(s.state.get()).toHaveLength(before + 1);
    const b = await s.save({ name: 'Camping 2', actions: { brightness: 9999, theme: 'not-a-theme', go: 'nowhere' } }, a.id);
    expect(b).toMatchObject({ id: a.id, icon: 'star', actions: { brightness: 100 } });
    expect(b.actions.theme).toBeUndefined();
    expect(b.actions.go).toBeUndefined();
    expect(await s.remove(a.id)).toBe(true);
    expect(await s.remove(a.id)).toBe(false);
    await expect(s.save({ name: '' })).rejects.toBeInstanceOf(SceneError);
    await expect(s.save({ name: 'x' }, 'missing')).rejects.toThrow('no longer exists');
  });

  it('limits how many there can be', async () => {
    const s = make();
    await s.start();
    while (s.state.get().length < 12) await s.save({ name: `S${s.state.get().length}` });
    await expect(s.save({ name: 'one too many' })).rejects.toThrow('At most 12');
  });

  it('survives a restart and a restore from a backup', async () => {
    const s = make();
    await s.start();
    const a = await s.save({ name: 'Mine', icon: 'party', actions: { volume: 80 } });
    await store.flush();
    const again = make();
    await again.start();
    expect(again.state.get().find((x) => x.id === a.id)).toMatchObject({ name: 'Mine', icon: 'party' });
    await again.restore({ scenes: [{ name: 'From backup', actions: { volume: 10 } }, { name: '' }, 'junk'] });
    expect(again.state.get().map((x) => x.name)).toEqual(['From backup']);
  });
});

describe('NotesService', () => {
  let t: number;
  beforeEach(() => void (t = 1000));
  const make = () => new NotesService(store, () => t++);

  it('creates a note and a checklist, giving every item an id', async () => {
    const n = make();
    await n.start();
    const note = await n.create({ title: 'Idea', kind: 'note', text: 'Add a roof box' });
    const list = await n.create({ title: 'Packing', kind: 'list', items: [{ text: 'Tent', done: true }, { text: 'Stove' }, { text: '   ' }] });
    expect(note.kind).toBe('note');
    expect(list.items.map((i) => [i.text, i.done])).toEqual([
      ['Tent', true],
      ['Stove', false],
    ]);
    expect(new Set(list.items.map((i) => i.id)).size).toBe(2);
    expect(list.items.every((i) => i.id.length > 3)).toBe(true);
  });

  it('lists pinned notes first, then the newest', async () => {
    const n = make();
    await n.start();
    const a = await n.create({ title: 'A', text: 'x' });
    const b = await n.create({ title: 'B', text: 'x' });
    const c = await n.create({ title: 'C', text: 'x', pinned: true });
    expect(n.list().map((x) => x.title)).toEqual(['C', 'B', 'A']);
    await n.update(a.id, { title: 'A', text: 'edited' });
    expect(n.list().map((x) => x.title)).toEqual(['C', 'A', 'B']);
    expect(b.id).not.toBe(c.id);
  });

  it('ticks an item off by saving the list again', async () => {
    const n = make();
    await n.start();
    const list = await n.create({ title: 'Shop', kind: 'list', items: [{ text: 'Milk' }] });
    const updated = await n.update(list.id, { ...list, items: list.items.map((i) => ({ ...i, done: true })) });
    expect(updated.items[0]).toMatchObject({ id: list.items[0]!.id, done: true });
  });

  it('refuses an empty note and bounds long ones', async () => {
    const n = make();
    await n.start();
    await expect(n.create({})).rejects.toBeInstanceOf(NoteError);
    await expect(n.create({ title: '', text: '', items: [] })).rejects.toThrow('needs a title');
    const long = await n.create({ title: 'x'.repeat(300), text: 'y'.repeat(9000) });
    expect(long.title.length).toBe(60);
    expect(long.text.length).toBe(4000);
    const items = await n.create({ title: 'many', kind: 'list', items: Array.from({ length: 300 }, (_, i) => ({ text: `i${i}` })) });
    expect(items.items).toHaveLength(100);
  });

  it('removes, reports a missing note, and survives a restart', async () => {
    const n = make();
    await n.start();
    const a = await n.create({ title: 'Keep', text: 'me' });
    const b = await n.create({ title: 'Drop', text: 'me' });
    expect(await n.remove(b.id)).toBe(true);
    expect(await n.remove(b.id)).toBe(false);
    await expect(n.update('nope', { title: 'x' })).rejects.toThrow('no longer exists');
    await store.flush();
    const again = make();
    await again.start();
    expect(again.list().map((x) => x.id)).toEqual([a.id]);
  });

  it('refuses to hold more than the limit', async () => {
    const n = make();
    await n.start();
    for (let i = 0; i < 80; i++) await n.create({ title: `n${i}`, text: 'x' });
    await expect(n.create({ title: 'extra', text: 'x' })).rejects.toThrow('At most 80');
  });
});

describe('DocStore', () => {
  it('only knows its fixed names', () => {
    expect(isDocName('perf')).toBe(true);
    expect(isDocName('arcade')).toBe(true);
    for (const bad of ['settings', 'credentials', '../settings', '', 'PERF', null, 5]) expect(isDocName(bad)).toBe(false);
  });

  it('keeps and returns a document', async () => {
    const d = new DocStore(store);
    expect(await d.get('perf')).toEqual({});
    await d.put('perf', { best0100: 8.4, runs: [1, 2, 3] });
    expect(await d.get('perf')).toEqual({ best0100: 8.4, runs: [1, 2, 3] });
    expect(await d.get('arcade')).toEqual({});
  });

  it('strips what is not plain data and caps depth, length and size', async () => {
    const d = new DocStore(store);
    const evil = JSON.parse('{"__proto__":{"x":1},"ok":1,"constructor":2,"nested":{"a":{"b":{"c":{"d":1}}}},"long":"' + 'z'.repeat(500) + '"}');
    const out = await d.put('arcade', evil);
    expect(out).toEqual({ ok: 1, nested: { a: { b: {} } }, long: 'z'.repeat(200) });
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // nothing leaked onto Object.prototype
    await expect(d.put('arcade', { big: Array.from({ length: 100 }, () => 'q'.repeat(200)) })).rejects.toThrow('too large');
    for (const bad of [null, 5, 'x', [1]]) await expect(d.put('arcade', bad)).rejects.toThrow('must be an object');
  });

  it('cleanDoc drops non-finite numbers, functions and undefined', () => {
    expect(cleanDoc({ a: Number.NaN, b: Infinity, c: () => 1, d: undefined, e: 2, f: [1, Number.NaN, 3] })).toEqual({ e: 2, f: [1, 3] });
  });
});
