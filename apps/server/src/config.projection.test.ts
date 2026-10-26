import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitCommand } from './shellwords';

// config.ts reads the environment once, when it is imported, so each case sets the environment and imports a fresh copy.
const helper = resolve(dirname(fileURLToPath(import.meta.url)), '../../../deploy/focus-window.sh');
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cfg test '));
  for (const k of ['PROJECTION_COMMAND', 'PROJECTION_AUTODETECT', 'PROJECTION_MODE', 'HEADUNIT_ALLOW_RESIDENT_AA', 'PROJECTION_FOCUS_COMMAND', 'PROJECTION_BACK_COMMAND']) {
    vi.stubEnv(k, undefined);
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});
const load = async () => (await import('./config')).config.projection;

describe.skipIf(process.platform !== 'linux')('projection config (Linux)', () => {
  it('uses the explicit Android Auto receiver command and resident mode', async () => {
    const app = join(dir, 'openauto-runtime.sh');
    await writeFile(app, '#!/bin/sh\n');
    vi.stubEnv('PROJECTION_COMMAND', app);
    vi.stubEnv('PROJECTION_MODE', 'resident');
    vi.stubEnv('HEADUNIT_ALLOW_RESIDENT_AA', '1');
    vi.stubEnv('PROJECTION_FOCUS_COMMAND', `${helper} android-auto`);
    vi.stubEnv('PROJECTION_BACK_COMMAND', `${helper} dashboard`);
    const p = await load();
    expect(p.mode).toBe('resident');
    expect(p.command).toBe(app);
    expect(splitCommand(p.focusCommand)).toEqual([helper, 'android-auto']);
    expect(splitCommand(p.backCommand)).toEqual([helper, 'dashboard']);
  });

  it('returns no projection receiver when no command is configured', async () => {
    const p = await load();
    expect(p.command).toBe('');
    expect(p.mode).toBe('ondemand');
    expect(p.focusCommand).toBe('');
    expect(p.backCommand).toBe('');
  });

  it('keeps explicit hook overrides exactly as configured', async () => {
    vi.stubEnv('PROJECTION_COMMAND', '/usr/local/bin/openauto-runtime');
    vi.stubEnv('PROJECTION_FOCUS_COMMAND', '/usr/local/bin/raise aa');
    vi.stubEnv('PROJECTION_BACK_COMMAND', '');
    const p = await load();
    expect(p.focusCommand).toBe('/usr/local/bin/raise aa');
    expect(p.backCommand).toBe('');
  });
});
