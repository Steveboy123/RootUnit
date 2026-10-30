/** Minimal observable value holder used by every provider. */
export class Observable<T> {
  private listeners = new Set<(v: T) => void>();
  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);
  }

  update(patch: Partial<T>): void {
    this.set({ ...this.value, ...patch });
  }

  subscribe(l: (v: T) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
