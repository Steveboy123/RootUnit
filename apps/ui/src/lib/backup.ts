export interface RestoreReport {
  restored: string[];
  skipped: Array<{ part: string; reason: string }>;
}

const PART_NAMES: Record<string, string> = {
  settings: 'Settings',
  layout: 'Dashboard layout',
  garage: 'Garage',
  trips: 'Trips',
  notes: 'Notes',
  scenes: 'Scenes',
  radio: 'Radio stations',
};

export const partName = (part: string) => PART_NAMES[part] ?? part;

/** What the screen says after a restore: one sentence of what came back, and one line for anything that did not. */
export function describeRestore(r: RestoreReport): { summary: string; problems: string[]; ok: boolean } {
  const problems = r.skipped.map((s) => `${partName(s.part)}: ${s.reason}`);
  const summary = r.restored.length === 0 ? 'Nothing was restored.' : `Restored ${list(r.restored.map(partName))}.`;
  return { summary, problems, ok: r.restored.length > 0 && problems.length === 0 };
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "12 KB" for a backup file in the list. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
