import { execFile } from 'node:child_process';
import { copyFile, mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import type { Config } from './config';

const execFileAsync = promisify(execFile);
const MAX_UPDATE_BYTES = 600 * 1024 * 1024;
/** RootUnit ZIPs keep the RPI-head-unit prefix so a v2 head unit (whose updater only knows that name) can install them too. */
const UPDATE_NAME = /^(RPI-head-unit|RootUnit).*\.zip$/i;

export interface DownloadedUpdate {
  fileName: string;
  version: string;
  size: number;
  modifiedAt: string;
  isNewer: boolean;
}

export interface UpdateStatus {
  enabled: boolean;
  version: string;
  rollbackAvailable: boolean;
  backup?: string;
  busy?: boolean;
  downloadedUpdate?: DownloadedUpdate;
}

async function projectVersion(projectDir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function versionTuple(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function newerThan(candidate: string, installed: string): boolean {
  const a = versionTuple(candidate);
  const b = versionTuple(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function zipProjectVersion(zip: string): Promise<string | null> {
  try {
    const { stdout: listing } = await execFileAsync('unzip', ['-Z1', zip], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const candidates = listing
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((name) => name.split('/').length <= 4 && name.endsWith('/package.json'));

    for (const entry of candidates.slice(0, 12)) {
      try {
        const { stdout } = await execFileAsync('unzip', ['-p', zip, entry], { timeout: 3000, maxBuffer: 256 * 1024 });
        const pkg = JSON.parse(stdout) as { name?: unknown; version?: unknown };
        if (pkg.name === 'rpi-head-unit' && typeof pkg.version === 'string' && pkg.version) return pkg.version;
      } catch {
        // Try the next package.json entry. Root validation still happens in the privileged helper before install.
      }
    }
  } catch {
    // Invalid/incomplete downloads are simply ignored by the easy updater.
  }
  return null;
}

async function newestDownloadedUpdate(config: Config, installed: string): Promise<DownloadedUpdate | undefined> {
  try {
    const entries = await readdir(config.updater.downloadDir, { withFileTypes: true });
    const files: Array<{ fileName: string; path: string; size: number; mtimeMs: number; modifiedAt: string }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !UPDATE_NAME.test(entry.name)) continue;
      const path = join(config.updater.downloadDir, entry.name);
      try {
        const s = await stat(path);
        if (s.size < 100 || s.size > MAX_UPDATE_BYTES) continue;
        files.push({ fileName: entry.name, path, size: s.size, mtimeMs: s.mtimeMs, modifiedAt: s.mtime.toISOString() });
      } catch {
        // It may have been renamed/removed while scanning.
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files.slice(0, 10)) {
      const version = await zipProjectVersion(file.path);
      if (!version) continue;
      return {
        fileName: file.fileName,
        version,
        size: file.size,
        modifiedAt: file.modifiedAt,
        isNewer: newerThan(version, installed),
      };
    }
  } catch {
    // Downloads may not exist yet; that is a normal state.
  }
  return undefined;
}

async function helper(config: Config, action: 'status' | 'apply' | 'rollback', arg?: string): Promise<string> {
  const args = ['-n', config.updater.helper, action];
  if (arg) args.push(arg);
  try {
    const { stdout } = await execFileAsync('sudo', args, {
      cwd: config.projectDir,
      timeout: action === 'status' ? 10_000 : 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    });
    return stdout.trim();
  } catch (e) {
    const err = e as Error & { stderr?: string };
    const detail = typeof err.stderr === 'string' ? err.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) : '';
    throw new Error(detail || err.message || 'Updater command failed.');
  }
}

export async function updateStatus(config: Config): Promise<UpdateStatus> {
  const version = await projectVersion(config.projectDir);
  if (!config.updater.enabled) return { enabled: false, version, rollbackAvailable: false };
  try {
    const [out, downloadedUpdate] = await Promise.all([
      helper(config, 'status'),
      newestDownloadedUpdate(config, version),
    ]);
    const lines = Object.fromEntries(
      out.split(/\r?\n/).map((line) => {
        const i = line.indexOf('=');
        return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)];
      }),
    );
    return {
      enabled: true,
      version,
      rollbackAvailable: lines.ROLLBACK_AVAILABLE === '1',
      backup: lines.BACKUP || undefined,
      downloadedUpdate,
    };
  } catch {
    return { enabled: false, version, rollbackAvailable: false };
  }
}

/** Saves a raw .zip request body to the updater inbox. The helper performs archive/path validation before root touches it. */
export async function receiveUpdateZip(config: Config, req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_UPDATE_BYTES) throw new Error('Update ZIP is too large (600 MB maximum).');
  await mkdir(config.updater.uploadDir, { recursive: true });
  const file = join(config.updater.uploadDir, `update-${Date.now()}-${process.pid}.zip`);
  const handle = await open(file, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_UPDATE_BYTES) throw new Error('Update ZIP is too large (600 MB maximum).');
      await handle.write(buf);
    }
    await handle.sync();
  } catch (e) {
    await handle.close().catch(() => undefined);
    await rm(file, { force: true }).catch(() => undefined);
    throw e;
  }
  await handle.close();
  if (size < 100) {
    await rm(file, { force: true }).catch(() => undefined);
    throw new Error('The update file is empty or invalid.');
  }
  return file;
}

export async function applyUpdate(config: Config, zip: string): Promise<void> {
  if (!config.updater.enabled) throw new Error('Updates are only available on the installed Raspberry Pi build.');
  try {
    await helper(config, 'apply', zip);
  } finally {
    await rm(zip, { force: true }).catch(() => undefined);
  }
}

/** One-tap updater: copy the newest valid RPI Head Unit ZIP from ~/Downloads into the protected updater inbox. */
export async function applyDownloadedUpdate(config: Config): Promise<void> {
  if (!config.updater.enabled) throw new Error('Updates are only available on the installed Raspberry Pi build.');
  const installed = await projectVersion(config.projectDir);
  const found = await newestDownloadedUpdate(config, installed);
  if (!found) throw new Error('No RPI Head Unit update ZIP was found in Downloads. Download the update on this Pi first.');

  // basename is defensive even though newestDownloadedUpdate only returns directory entries.
  const source = join(config.updater.downloadDir, basename(found.fileName));
  const s = await stat(source);
  if (s.size < 100 || s.size > MAX_UPDATE_BYTES) throw new Error('Downloaded update ZIP is invalid or too large.');

  await mkdir(config.updater.uploadDir, { recursive: true });
  const staged = join(config.updater.uploadDir, `download-${Date.now()}-${process.pid}.zip`);
  await copyFile(source, staged);
  await applyUpdate(config, staged);
}

export async function rollbackUpdate(config: Config): Promise<void> {
  if (!config.updater.enabled) throw new Error('Rollback is only available on the installed Raspberry Pi build.');
  await helper(config, 'rollback');
}
