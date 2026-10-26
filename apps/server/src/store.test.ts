import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonStore } from './store';

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'hu-store-'))));
afterEach(async () => {
  vi.restoreAllMocks();
  await chmod(dir, 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);
const names = async () => (await readdir(dir)).sort();

describe('JsonStore basics', () => {
  it('writes atomically with mode 0600 and reads the value back', async () => {
    const store = new JsonStore(dir);
    await store.write('a.json', { x: 1 });
    expect(await store.read('a.json')).toEqual({ x: 1 });
    expect(JSON.parse(await readFile(join(dir, 'a.json'), 'utf8'))).toEqual({ x: 1 });
    const { mode } = await (await import('node:fs/promises')).stat(join(dir, 'a.json'));
    if (process.platform !== 'win32') expect(mode & 0o777).toBe(0o600);
    expect((await names()).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a missing file reads as null without any noise', async () => {
    const log = quiet();
    expect(await new JsonStore(dir).read('nope.json')).toBeNull();
    expect(await new JsonStore(join(dir, 'does', 'not', 'exist')).read('nope.json')).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('creates the data folder on the first write, including nested names', async () => {
    const store = new JsonStore(join(dir, 'data'));
    await store.write('sub/b.json', [1, 2]);
    expect(await store.read('sub/b.json')).toEqual([1, 2]);
  });

  it('coalesces queued writes of one file: the last value wins, every caller resolves', async () => {
    const store = new JsonStore(dir);
    const all = await Promise.all([store.write('a.json', 1), store.write('a.json', 2), store.write('a.json', 3), store.write('b.json', 'b')]);
    expect(all).toHaveLength(4);
    expect(await store.read('a.json')).toBe(3);
    expect(await store.read('b.json')).toBe('b');
  });

  it('flush() resolves once everything queued is on disk', async () => {
    const store = new JsonStore(dir);
    void store.write('a.json', { n: 1 });
    void store.write('b.json', { n: 2 });
    await store.flush();
    expect(JSON.parse(await readFile(join(dir, 'b.json'), 'utf8'))).toEqual({ n: 2 });
  });
});

describe('failed writes are not reported as successes', () => {
  /** A data folder that cannot exist (its parent is a file): works the same for root and for ordinary users. */
  async function brokenStore() {
    const blocker = join(dir, 'not-a-folder');
    await writeFile(blocker, 'x');
    return new JsonStore(join(blocker, 'data'));
  }

  it('writeOrThrow rejects with the error', async () => {
    quiet();
    const store = await brokenStore();
    await expect(store.writeOrThrow('a.json', { x: 1 })).rejects.toThrow();
  });

  it('write() stays safe for fire-and-forget callers (it logs and resolves) so nothing becomes an unhandled rejection', async () => {
    const log = quiet();
    const store = await brokenStore();
    await expect(store.write('a.json', { x: 1 })).resolves.toBeUndefined();
    await expect(store.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('failed to write a.json'), expect.anything());
  });

  it('one failing file does not stop the others or later writes', async () => {
    quiet();
    const store = new JsonStore(dir);
    await mkdir(join(dir, 'bad.json.tmp')); // opening this as a file fails with EISDIR, even for root
    const failing = store.writeOrThrow('bad.json', 1);
    const fine = store.writeOrThrow('good.json', 2);
    await expect(failing).rejects.toThrow();
    await expect(fine).resolves.toBeUndefined();
    expect(await store.read('good.json')).toBe(2);
    await rm(join(dir, 'bad.json.tmp'), { recursive: true });
    await expect(store.writeOrThrow('bad.json', 3)).resolves.toBeUndefined();
    expect(await store.read('bad.json')).toBe(3);
  });

  it('a read-only folder fails the write when the user cannot write there (skipped when running as root)', async () => {
    quiet();
    if (process.platform === 'win32' || (process.getuid?.() ?? 1) === 0) return;
    const store = new JsonStore(dir);
    await store.write('a.json', { v: 1 });
    await chmod(dir, 0o500);
    await expect(store.writeOrThrow('a.json', { v: 2 })).rejects.toThrow();
    await chmod(dir, 0o700);
    expect(await store.read('a.json')).toEqual({ v: 1 });
  });

  it('a failed write leaves the previous file untouched and no temp file behind', async () => {
    quiet();
    const store = new JsonStore(dir);
    await store.write('a.json', { v: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(store.writeOrThrow('a.json', circular)).rejects.toThrow();
    expect(await store.read('a.json')).toEqual({ v: 1 });
    expect((await names()).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('an unreadable file is never treated as empty in a way that loses data', () => {
  it('keeps a .bak of the last good content and serves it when the file turns corrupt', async () => {
    const log = quiet();
    const store = new JsonStore(dir);
    await store.write('credentials.json', { tidal: { clientId: 'one' } });
    await store.write('credentials.json', { tidal: { clientId: 'two' } });
    expect(JSON.parse(await readFile(join(dir, 'credentials.json.bak'), 'utf8'))).toEqual({ tidal: { clientId: 'two' } });

    await writeFile(join(dir, 'credentials.json'), '{ "tidal": { "clientId": "tw'); // power cut / bad edit
    expect(await new JsonStore(dir).read('credentials.json')).toEqual({ tidal: { clientId: 'two' } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('credentials.json'), expect.anything());
  });

  it('moves a corrupt file aside instead of overwriting it', async () => {
    quiet();
    const store = new JsonStore(dir);
    await store.write('tidal.json', { accessToken: 'A' });
    await store.write('tidal.json', { accessToken: 'B' });
    await writeFile(join(dir, 'tidal.json'), 'garbage{');
    // A read-modify-write caller (like the credentials file) starts from the backup, not from "empty"
    expect(await store.read('tidal.json')).toEqual({ accessToken: 'B' });
    await store.write('tidal.json', { accessToken: 'C' });

    expect(await store.read('tidal.json')).toEqual({ accessToken: 'C' });
    const aside = (await names()).filter((n) => n.startsWith('tidal.json.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(join(dir, aside[0]!), 'utf8')).toBe('garbage{');
  });

  it('a corrupt file with no backup reads as null (as before) but is preserved when the next write comes', async () => {
    quiet();
    await writeFile(join(dir, 'x.json'), 'not json');
    const store = new JsonStore(dir);
    expect(await store.read('x.json')).toBeNull();
    await store.write('x.json', { fresh: true });
    expect(await store.read('x.json')).toEqual({ fresh: true });
    const aside = (await names()).filter((n) => n.startsWith('x.json.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(join(dir, aside[0]!), 'utf8')).toBe('not json');
  });

  it('a path that is not a readable file (a directory) is reported as unreadable and moved aside, not deleted', async () => {
    quiet();
    await mkdir(join(dir, 'odd.json'));
    await writeFile(join(dir, 'odd.json', 'keep.txt'), 'precious');
    const store = new JsonStore(dir);
    expect(await store.read('odd.json')).toBeNull();
    await store.write('odd.json', { ok: 1 });
    expect(await store.read('odd.json')).toEqual({ ok: 1 });
    const aside = (await names()).filter((n) => n.startsWith('odd.json.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(await readFile(join(dir, aside[0]!, 'keep.txt'), 'utf8')).toBe('precious');
  });

  it('refuses to write (rather than overwrite) when the corrupt file cannot be moved aside', async () => {
    quiet();
    // The aside name is the file name + ".corrupt-<time>": too long for the file system when the name is already 245 characters.
    const long = `${'a'.repeat(240)}.json`;
    await writeFile(join(dir, long), 'garbage');
    const store = new JsonStore(dir);
    await expect(store.writeOrThrow(long, { v: 1 })).rejects.toThrow();
    expect(await readFile(join(dir, long), 'utf8')).toBe('garbage');
    expect((await names()).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a valid file is never moved aside and the .bak follows each write', async () => {
    const store = new JsonStore(dir);
    for (let i = 1; i <= 3; i++) await store.write('a.json', { i });
    expect(await names()).toEqual(['a.json', 'a.json.bak']);
    expect(JSON.parse(await readFile(join(dir, 'a.json.bak'), 'utf8'))).toEqual({ i: 3 });
  });

  it('a failing backup never fails the save', async () => {
    quiet();
    const store = new JsonStore(dir);
    await mkdir(join(dir, 'a.json.bak')); // the backup cannot replace a folder
    await expect(store.writeOrThrow('a.json', { i: 1 })).resolves.toBeUndefined();
    expect(await store.read('a.json')).toEqual({ i: 1 });
    expect((await names()).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a deleted file reads as null even if an old .bak is lying around (deleting the file is how you reset)', async () => {
    const store = new JsonStore(dir);
    await store.write('a.json', { i: 1 });
    await rm(join(dir, 'a.json'));
    expect(await store.read('a.json')).toBeNull();
  });
});
