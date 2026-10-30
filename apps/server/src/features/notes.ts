import { randomUUID } from 'node:crypto';
import { ID_RE, NOTE_LIMITS, sanitizeNote, type Note } from '@headunit/shared';
import type { JsonStore } from '../store';

const FILE = 'notes.json';

export class NoteError extends Error {}

const newId = () => randomUUID().replace(/-/g, '').slice(0, 10);

/** Notes and checklists kept on the head unit (a packing list for a road trip, what to buy on the way home). */
export class NotesService {
  private notes: Note[] = [];

  constructor(
    private store: JsonStore,
    private now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {
    this.notes = this.parse(((await this.store.read(FILE)) as { notes?: unknown[] } | null)?.notes);
  }

  /** Pinned first, then the most recently changed. */
  list(): Note[] {
    return [...this.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }

  async create(input: unknown): Promise<Note> {
    if (this.notes.length >= NOTE_LIMITS.max) throw new NoteError(`At most ${NOTE_LIMITS.max} notes. Delete one first.`);
    const n = sanitizeNote(input);
    if (!n) throw new NoteError('A note needs a title, some text or at least one item.');
    const note: Note = { ...n, id: newId(), updatedAt: this.now(), items: n.items.map((i) => ({ ...i, id: i.id || newId() })) };
    this.notes = [note, ...this.notes];
    await this.save();
    return note;
  }

  async update(id: string, input: unknown): Promise<Note> {
    const old = this.notes.find((n) => n.id === id);
    if (!old) throw new NoteError('That note no longer exists.');
    const n = sanitizeNote(input);
    if (!n) throw new NoteError('A note needs a title, some text or at least one item.');
    const note: Note = { ...n, id, updatedAt: this.now(), items: n.items.map((i) => ({ ...i, id: i.id || newId() })) };
    this.notes = this.notes.map((x) => (x.id === id ? note : x));
    await this.save();
    return note;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.notes.length === before) return false;
    await this.save();
    return true;
  }

  export(): unknown {
    return { notes: this.notes };
  }

  async restore(raw: unknown): Promise<void> {
    this.notes = this.parse((raw as { notes?: unknown[] } | null)?.notes);
    await this.save();
  }

  private parse(list: unknown): Note[] {
    const out: Note[] = [];
    for (const r of Array.isArray(list) ? list.slice(0, NOTE_LIMITS.max) : []) {
      const n = sanitizeNote(r);
      if (!n) continue;
      const given = (r as { id?: unknown }).id;
      const at = (r as { updatedAt?: unknown }).updatedAt;
      out.push({ ...n, id: typeof given === 'string' && ID_RE.test(given) ? given : newId(), updatedAt: typeof at === 'number' && Number.isFinite(at) ? at : this.now(), items: n.items.map((i) => ({ ...i, id: i.id || newId() })) });
    }
    return out;
  }

  private save(): Promise<void> {
    return this.store.writeOrThrow(FILE, { notes: this.notes });
  }
}
