import { sanitizeLayout, sanitizeSettings, type DashboardLayout, type Settings } from '@headunit/shared';

export const BACKUP_APP = 'rpi-head-unit';
export const BACKUP_VERSION = 2;
/** A backup is a few hundred KB at most; anything bigger is not one. */
export const BACKUP_MAX_BYTES = 2 * 1024 * 1024;
/** Where Chromium saves a downloaded backup on the Pi, and the only names the restore will read from there. */
export const BACKUP_FILE_RE = /^headunit-backup-[0-9]{8}-[0-9]{4}\.json$/;

export interface BackupSources {
  settings(): Settings;
  layout(): DashboardLayout;
  garage(): unknown;
  trips(): unknown;
  notes(): unknown;
  scenes(): unknown;
  /** Custom stations and favourites (the built-in list is not needed). */
  radio(): unknown;
}

/** Which of the three arrangements the backup's settings actually carried (a backup made before they existed carries none). */
export interface CarriedArrangements {
  nav: boolean;
  launcher: boolean;
  panel: boolean;
}

export interface BackupSinks {
  settings(s: Settings, carried: CarriedArrangements): void | Promise<void>;
  layout(l: DashboardLayout): void | Promise<void>;
  garage(raw: unknown): Promise<void>;
  trips(raw: unknown): Promise<number | void>;
  notes(raw: unknown): Promise<void>;
  scenes(raw: unknown): Promise<void>;
  radio(raw: unknown): Promise<void>;
}

export interface BackupBundle {
  app: typeof BACKUP_APP;
  version: number;
  createdAt: string;
  data: Record<string, unknown>;
}

/**
 * Everything the owner has made or chosen. What is NOT in it, on purpose: music sign-ins and client secrets, the YouTube key, the
 * Android pairing, quick-action addresses (they can carry a secret) and dashcam clips. A backup file lies in a Downloads folder; it
 * must never be a way to get hold of an account.
 */
export function createBackup(src: BackupSources, now: Date = new Date()): BackupBundle {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    data: { settings: src.settings(), layout: src.layout(), garage: src.garage(), trips: src.trips(), notes: src.notes(), scenes: src.scenes(), radio: src.radio() },
  };
}

export const backupFileName = (now: Date = new Date()): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `headunit-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
};

export class BackupError extends Error {}

/**
 * The settings to put in place of the current ones when a backup is restored. A backup made before the navigation, the launcher or the
 * Quick Panel could be arranged says nothing about them, so what the person has arranged since stays: restoring an old backup must not
 * undo something it never knew about. (One that carries them, even damaged, replaces them: that is what the backup holds.)
 */
export function settingsToRestore(restored: Settings, carried: CarriedArrangements, current: Settings): Settings {
  return {
    ...restored,
    ...(carried.nav ? {} : { nav: current.nav }),
    ...(carried.launcher ? {} : { launcher: current.launcher }),
    ...(carried.panel ? {} : { panel: current.panel }),
  };
}

export interface RestoreReport {
  restored: string[];
  skipped: Array<{ part: string; reason: string }>;
}

/** Check that this is one of ours, then put each part back through the same validation a fresh load would use. */
export async function restoreBackup(raw: unknown, sinks: BackupSinks): Promise<RestoreReport> {
  const b = raw as Partial<BackupBundle> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP || typeof b.data !== 'object' || b.data === null) throw new BackupError('This is not a head unit backup file.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION || b.version < 1) throw new BackupError('This backup was made by a newer version of the head unit. Update first.');
  const data = b.data as Record<string, unknown>;
  const report: RestoreReport = { restored: [], skipped: [] };

  const part = async (name: string, present: boolean, fn: () => void | Promise<unknown>) => {
    if (!present) return;
    try {
      await fn();
      report.restored.push(name);
    } catch (err) {
      report.skipped.push({ part: name, reason: err instanceof Error ? err.message : 'It could not be restored.' });
    }
  };

  await part('settings', 'settings' in data, () => {
    const raw = data.settings;
    const has = (key: string) => typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, key);
    return sinks.settings(sanitizeSettings(raw), { nav: has('nav'), launcher: has('launcher'), panel: has('panel') });
  });
  await part('layout', 'layout' in data, () => {
    const layout = sanitizeLayout(data.layout);
    if (!layout) throw new BackupError('The dashboard layout in the backup is damaged.');
    return sinks.layout(layout);
  });
  await part('garage', 'garage' in data, () => sinks.garage(data.garage));
  await part('trips', 'trips' in data, () => sinks.trips(data.trips));
  await part('notes', 'notes' in data, () => sinks.notes(data.notes));
  await part('scenes', 'scenes' in data, () => sinks.scenes(data.scenes));
  await part('radio', 'radio' in data, () => sinks.radio(data.radio));
  return report;
}
