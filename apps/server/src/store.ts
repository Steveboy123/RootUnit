import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

interface Ticket {
  resolve: () => void;
  reject: (err: unknown) => void;
}

/** The file (or its folder) is simply not there: that is "nothing saved yet", not a problem. */
const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR';

/**
 * Tiny JSON-file persistence: atomic writes (temp file, fsync, rename) so a power cut can't corrupt settings.
 *
 * Each file also keeps a `.bak` copy of the last good content. A file that cannot be read (corrupt JSON, an I/O
 * error) is served from that copy, and is never overwritten in place: the next write moves it aside as
 * `<name>.corrupt-<time>` first, so credentials are never silently replaced by an "empty" state.
 */
export class JsonStore {
  private pending = new Map<string, { value: unknown; tickets: Ticket[] }>();
  /** Never rejects: failures are reported to the callers of the writes that failed. */
  private writing: Promise<void> = Promise.resolve();

  constructor(private dir: string) {}

  /** The saved value; null when nothing is saved (or nothing readable is: then see the log and `.bak`). */
  async read(name: string): Promise<unknown | null> {
    const file = join(this.dir, name);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      if (isMissing(err)) return null;
      console.error(`[store] ${name} is unreadable:`, err);
    }
    try {
      const backup = JSON.parse(await readFile(`${file}.bak`, 'utf8'));
      console.error(`[store] using the backup copy of ${name}`);
      return backup;
    } catch {
      return null;
    }
  }

  /** Resolves once every write queued so far has been attempted (never rejects; see `writeOrThrow`). */
  flush(): Promise<void> {
    return this.writing;
  }

  /**
   * Queue a write; resolves when it has reached disk and REJECTS if it could not be saved (full or read-only disk,
   * a corrupt file that could not be moved aside). Use this wherever the user must be told that saving failed.
   */
  writeOrThrow(name: string, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const slot = this.pending.get(name);
      if (slot) {
        slot.value = value;
        slot.tickets.push({ resolve, reject });
      } else {
        this.pending.set(name, { value, tickets: [{ resolve, reject }] });
      }
      this.writing = this.writing.then(() => this.drain());
    });
  }

  /**
   * Queue a write for callers that cannot do anything about a failure (fire-and-forget): a failure is logged and the
   * promise still resolves, because an unhandled rejection would take the whole server down.
   */
  write(name: string, value: unknown): Promise<void> {
    return this.writeOrThrow(name, value).catch(() => undefined);
  }

  private async drain(): Promise<void> {
    const batch = [...this.pending];
    this.pending.clear();
    for (const [name, slot] of batch) {
      try {
        await this.persist(name, slot.value);
        for (const t of slot.tickets) t.resolve();
      } catch (err) {
        console.error(`[store] failed to write ${name}:`, err);
        for (const t of slot.tickets) t.reject(err);
      }
    }
  }

  private async persist(name: string, value: unknown): Promise<void> {
    const file = join(this.dir, name);
    const tmp = `${file}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      const data = JSON.stringify(value, null, 2);
      await this.writeSynced(tmp, data);
      await this.setAsideIfDamaged(file, name);
      await rename(tmp, file);
      await this.keepBackup(file, name, data);
    } catch (err) {
      // not recursive: a folder that happens to be called *.tmp is not ours to delete
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  private async writeSynced(path: string, data: string): Promise<void> {
    const handle = await open(path, 'w', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** An existing file that cannot be read or parsed must not be replaced by a rename: keep it for inspection. */
  private async setAsideIfDamaged(file: string, name: string): Promise<void> {
    try {
      JSON.parse(await readFile(file, 'utf8'));
      return;
    } catch (err) {
      if (isMissing(err)) return;
      const aside = `${file}.corrupt-${Date.now()}`;
      console.error(`[store] ${name} is unreadable and is kept as ${basename(aside)} before it is replaced:`, err);
      await rename(file, aside); // if this fails the write fails: better than destroying the only copy
    }
  }

  /** `.bak` mirrors the file just written. Best effort: a failing backup never fails the save. */
  private async keepBackup(file: string, name: string, data: string): Promise<void> {
    const tmp = `${file}.bak.tmp`;
    try {
      await this.writeSynced(tmp, data);
      await rename(tmp, `${file}.bak`);
    } catch (err) {
      console.error(`[store] could not keep a backup copy of ${name}:`, err);
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }
}
