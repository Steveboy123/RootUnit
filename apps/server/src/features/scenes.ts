import { randomUUID } from 'node:crypto';
import { ID_RE, SCENE_LIMITS, THEME_IDS, sanitizeScene, type Scene } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const FILE = 'scenes.json';

/** What a fresh head unit starts with. The owner can change or delete all of them. */
export const DEFAULT_SCENES: Array<Omit<Scene, 'id'>> = [
  { name: 'Night drive', icon: 'moon', actions: { theme: 'midnight', brightness: 35, lights: { enabled: true, color: '#2a4bff', brightness: 40 } } },
  { name: 'Road trip', icon: 'road', actions: { go: 'drive', brightness: 80, volume: 60 } },
  { name: 'Daylight', icon: 'sun', actions: { theme: 'daylight', brightness: 100 } },
  { name: 'Parked', icon: 'parking', actions: { standby: true, brightness: 25, lights: { enabled: false } } },
];

export class SceneError extends Error {}

/** A scene is a saved bundle of settings (look, brightness, volume, lights, where to go). The screen applies it; this only keeps the list. */
export class ScenesService {
  readonly state = new Observable<Scene[]>([]);
  private scenes: Scene[] = [];
  private readonly newId: () => string;

  constructor(
    private store: JsonStore,
    newId?: () => string,
  ) {
    this.newId = newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));
  }

  async start(): Promise<void> {
    const raw = (await this.store.read(FILE)) as { scenes?: unknown[] } | null;
    // No file at all = a first run: seed the defaults. A file with an empty list = the owner deleted them: respect that.
    this.scenes = raw === null ? DEFAULT_SCENES.map((s) => ({ ...s, id: this.newId() })) : this.parse(raw.scenes);
    if (raw === null) await this.store.write(FILE, { scenes: this.scenes });
    this.publish();
  }

  async save(input: unknown, id?: string): Promise<Scene> {
    const s = sanitizeScene(input, THEME_IDS);
    if (!s) throw new SceneError('Give the scene a name.');
    if (id) {
      if (!this.scenes.some((x) => x.id === id)) throw new SceneError('That scene no longer exists.');
      const scene: Scene = { ...s, id };
      this.scenes = this.scenes.map((x) => (x.id === id ? scene : x));
      await this.commit();
      return scene;
    }
    if (this.scenes.length >= SCENE_LIMITS.max) throw new SceneError(`At most ${SCENE_LIMITS.max} scenes. Delete one first.`);
    const scene: Scene = { ...s, id: this.newId() };
    this.scenes = [...this.scenes, scene];
    await this.commit();
    return scene;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.scenes.length;
    this.scenes = this.scenes.filter((s) => s.id !== id);
    if (this.scenes.length === before) return false;
    await this.commit();
    return true;
  }

  export(): unknown {
    return { scenes: this.scenes };
  }

  async restore(raw: unknown): Promise<void> {
    this.scenes = this.parse((raw as { scenes?: unknown[] } | null)?.scenes);
    await this.commit();
  }

  private parse(list: unknown): Scene[] {
    const out: Scene[] = [];
    for (const r of Array.isArray(list) ? list.slice(0, SCENE_LIMITS.max) : []) {
      const s = sanitizeScene(r, THEME_IDS);
      const given = (r as { id?: unknown })?.id;
      if (s) out.push({ ...s, id: typeof given === 'string' && ID_RE.test(given) ? given : this.newId() });
    }
    return out;
  }

  private async commit(): Promise<void> {
    this.publish();
    await this.store.writeOrThrow(FILE, { scenes: this.scenes });
  }

  private publish(): void {
    this.state.set(this.scenes);
  }
}
