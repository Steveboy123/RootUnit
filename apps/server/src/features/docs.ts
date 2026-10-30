import type { JsonStore } from '../store';

/**
 * Small documents that the screen owns and the server only keeps (best times, game scores). A fixed list of names, a size cap and a
 * depth cap, so nothing a page sends can fill the disk or become anything other than plain data.
 */
export const DOC_NAMES = ['perf', 'arcade'] as const;
export type DocName = (typeof DOC_NAMES)[number];

const MAX_BYTES = 16 * 1024;
const MAX_DEPTH = 4;

export const isDocName = (v: unknown): v is DocName => typeof v === 'string' && (DOC_NAMES as readonly string[]).includes(v);

/** Plain JSON data only: objects, arrays, strings, finite numbers, booleans, null. Anything else (or too deep or too big) is refused. */
export function cleanDoc(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 200);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => cleanDoc(v, depth + 1)).filter((v) => v !== undefined);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 64) continue;
      const c = cleanDoc(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export class DocStore {
  constructor(private store: JsonStore) {}

  async get(name: DocName): Promise<Record<string, unknown>> {
    const v = await this.store.read(`doc-${name}.json`);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }

  /** Throws when the document is not a plain object or is too large. */
  async put(name: DocName, value: unknown): Promise<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('A document must be an object.');
    const clean = cleanDoc(value) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(clean)) > MAX_BYTES) throw new Error('That document is too large.');
    await this.store.writeOrThrow(`doc-${name}.json`, clean);
    return clean;
  }
}
