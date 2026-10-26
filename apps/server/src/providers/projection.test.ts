import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectionState } from '@headunit/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observable } from '../observable';
import { joinCommand } from '../shellwords';
import type { MediaProvider } from './media';
import { createMockProjection } from '../demo/projection';
import { createExternalProjection, createProjection, yieldAudioToProjection, type ProjectionProvider } from './projection';
import type { RadioProvider } from '../radio/radio';

const node = process.execPath;
const LONG = 'setInterval(()=>{},1000)';
const posix = process.platform !== 'win32';

let dir: string;
let made: ProjectionProvider[] = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'proj-'))));
afterEach(async () => {
  for (const p of made) p.dispose();
  made = [];
  await rm(dir, { recursive: true, force: true });
});

const cfg = (over: Partial<Parameters<typeof createExternalProjection>[0]> = {}) => ({
  command: node,
  args: ['-e', LONG],
  mode: 'ondemand' as const,
  focusCommand: '',
  backCommand: '',
  ...over,
});
const make = (c: ReturnType<typeof cfg>, extra: Parameters<typeof createExternalProjection>[1] = {}) => {
  const p = createExternalProjection(c, { restartDelaysMs: [20], killGraceMs: 500, hookTimeoutMs: 2000, ...extra });
  made.push(p);
  return p;
};
async function waitFor(pred: () => boolean | Promise<boolean>, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** The process is 'spawned' before Node has booted and run the script, so wait for the file. */
async function readPid(file: string): Promise<number> {
  await waitFor(async () => !!(await readFile(file, 'utf8').catch(() => '')), `pid file ${file}`);
  return Number(await readFile(file, 'utf8'));
}
const hook = (file: string, text: string) => `"${node}" -e "require('fs').writeFileSync('${file}','${text}')"`;
/** A hook that takes `ms` to finish (like the real focus helper waiting for the window), then appends an 'x'. */
const slowHook = (file: string, ms: number) => `"${node}" -e "setTimeout(()=>require('fs').appendFileSync('${file}','x'),${ms})"`;
const read = (file: string) => readFile(file, 'utf8').catch(() => '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mock projection', () => {
  it('walks idle → starting → active → idle', async () => {
    const p = createMockProjection();
    await p.launch();
    expect(p.state.get().status).toBe('starting');
    await waitFor(() => p.state.get().status === 'active', 'active');
    await p.stop();
    expect(p.state.get().status).toBe('idle');
  });
});

describe('production projection fallback', () => {
  it('does not fake Android Auto when no native receiver is configured', async () => {
    const p = createProjection({ command: '', args: [], mode: 'resident', focusCommand: '', backCommand: '' });
    expect(p.state.get()).toMatchObject({ provider: 'external', running: false, status: 'unavailable' });
    await p.launch();
    expect(p.state.get().status).toBe('unavailable');
    p.dispose();
  });
});

describe('external projection — ondemand', () => {
  it('launch starts the app and stop kills it', async () => {
    const p = make(cfg());
    await p.launch();
    await waitFor(() => p.state.get().status === 'active', 'active');
    expect(p.state.get()).toMatchObject({ running: true, mode: 'ondemand' });
    await p.launch(); // idempotent
    expect(p.state.get().status).toBe('active');
    await p.stop();
    await waitFor(() => p.state.get().status === 'idle', 'idle after stop');
    expect(p.state.get().running).toBe(false);
  });

  it('reports a missing executable', async () => {
    const p = make(cfg({ command: join(dir, 'does-not-exist') }));
    await p.launch();
    await waitFor(() => p.state.get().status === 'error', 'error');
    expect(p.state.get().detail).toMatch(/ENOENT/);
  });

  it('reports a crash with its exit code', async () => {
    const p = make(cfg({ args: ['-e', 'process.exit(3)'] }));
    await p.launch();
    await waitFor(() => p.state.get().status === 'error', 'error');
    expect(p.state.get().detail).toContain('code 3');
  });

  it.skipIf(!posix)('stop also kills processes the app spawned (no orphans)', async () => {
    const pidFile = join(dir, 'grandchild.pid');
    const script = `const c=require('child_process').spawn(process.execPath,['-e','${LONG}'],{stdio:'ignore'});require('fs').writeFileSync('${pidFile}',String(c.pid));${LONG}`;
    const p = make(cfg({ args: ['-e', script] }));
    await p.launch();
    await waitFor(async () => !!(await readFile(pidFile, 'utf8').catch(() => '')), 'grandchild pid');
    const grandchild = Number(await readFile(pidFile, 'utf8'));
    expect(alive(grandchild)).toBe(true);
    await p.stop();
    await waitFor(() => !alive(grandchild), 'grandchild to die');
  });
});

describe('external projection — resident (wireless Android Auto)', () => {
  it('starts at boot in the background and restarts after a crash', async () => {
    const pidFile = join(dir, 'app.pid');
    const script = `require('fs').writeFileSync('${pidFile}',String(process.pid));${LONG}`;
    const p = make(cfg({ mode: 'resident', args: ['-e', script] }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    expect(p.state.get().status).toBe('idle'); // running but not on screen
    const first = await readPid(pidFile);
    process.kill(first, 'SIGKILL');
    await waitFor(() => p.state.get().status === 'error', 'crash detected');
    expect(p.state.get().detail).toMatch(/restarting/);
    await waitFor(() => p.state.get().running, 'restart');
    await waitFor(async () => Number(await readFile(pidFile, 'utf8')) !== first, 'new pid written');
    expect(p.state.get().status).toBe('idle');
  });

  it('launch runs the focus command, stop runs the back command', async () => {
    const f = join(dir, 'focus'), b = join(dir, 'back');
    const p = make(cfg({ mode: 'resident', focusCommand: hook(f, 'raised'), backCommand: hook(b, 'lowered') }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    await p.launch();
    expect(p.state.get().status).toBe('active');
    expect(await readFile(f, 'utf8')).toBe('raised');
    await p.stop();
    expect(p.state.get().status).toBe('idle');
    expect(await readFile(b, 'utf8')).toBe('lowered');
    expect(p.state.get().running).toBe(true); // stop never kills a resident app
  });

  it('explains what to configure when hooks are missing', async () => {
    const p = make(cfg({ mode: 'resident' }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    await p.launch();
    expect(p.state.get()).toMatchObject({ status: 'error' });
    expect(p.state.get().detail).toContain('PROJECTION_FOCUS_COMMAND');
    await p.stop();
    expect(p.state.get().detail).toContain('PROJECTION_BACK_COMMAND');
  });

  it('surfaces a failing focus command instead of claiming success', async () => {
    const p = make(cfg({ mode: 'resident', focusCommand: `"${node}" -e "process.exit(1)"` }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    await p.launch();
    expect(p.state.get().status).toBe('error');
    expect(p.state.get().detail).toContain("Couldn't show Android Auto");
  });

  it('refuses to show Android Auto when the app is down', async () => {
    const p = make(cfg({ mode: 'resident', command: join(dir, 'missing'), focusCommand: hook(join(dir, 'x'), 'y') }));
    p.start();
    await waitFor(() => p.state.get().status === 'error', 'spawn error');
    await p.launch();
    expect(p.state.get().detail).toMatch(/not running|ENOENT|restarting/);
    await expect(readFile(join(dir, 'x'), 'utf8')).rejects.toThrow(); // focus hook must NOT have run
  });

  it('dispose kills the app and stops restarting it', async () => {
    const pidFile = join(dir, 'p.pid');
    const p = make(cfg({ mode: 'resident', args: ['-e', `require('fs').writeFileSync('${pidFile}',String(process.pid));${LONG}`] }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    const pid = await readPid(pidFile);
    p.dispose();
    await waitFor(() => !alive(pid), 'process to exit');
    await new Promise((r) => setTimeout(r, 120)); // longer than the 20ms restart delay
    expect(p.state.get().running).toBe(false);
    await writeFile(pidFile, '0');
    await new Promise((r) => setTimeout(r, 120));
    expect(await readFile(pidFile, 'utf8')).toBe('0'); // nothing re-spawned and rewrote it
  });
});

describe('external projection — resident: concurrent requests', () => {
  const resident = async (over: Partial<ReturnType<typeof cfg>> = {}, extra = {}) => {
    const p = make(cfg({ mode: 'resident', ...over }), extra);
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    return p;
  };

  it('a stop that arrives during a slow launch runs afterwards instead of being dropped', async () => {
    const f = join(dir, 'focus'), b = join(dir, 'back');
    const p = await resident({ focusCommand: slowHook(f, 300), backCommand: hook(b, 'lowered') });
    const launching = p.launch();
    await waitFor(() => p.state.get().status === 'starting', 'starting');
    await p.stop(); // returns at once: the request is queued
    expect(await read(b)).toBe('');
    await launching; // the queued stop has run by the time the first call settles
    expect(await read(f)).toBe('x');
    expect(await read(b)).toBe('lowered');
    expect(p.state.get().status).toBe('idle'); // the newest request won
  });

  it('asking again for what is already running does nothing, and cancels a pending opposite request', async () => {
    const f = join(dir, 'focus'), b = join(dir, 'back');
    const p = await resident({ focusCommand: slowHook(f, 250), backCommand: hook(b, 'lowered') });
    const first = p.launch();
    await waitFor(() => p.state.get().status === 'starting', 'starting');
    await p.stop(); // queued…
    await p.launch(); // …and withdrawn again: the driver's last word was "show it"
    await first;
    expect(await read(f)).toBe('x'); // one focus run, not two
    expect(await read(b)).toBe(''); // the stop never ran
    expect(p.state.get().status).toBe('active');
  });
});

describe('external projection — resident: hooks', () => {
  it('runs a focus command whose path contains a space', async () => {
    const spaced = join(dir, 'RPI Head Unit', 'deploy');
    await mkdir(spaced, { recursive: true });
    const script = join(spaced, 'focus.js');
    const out = join(dir, 'argv.json');
    await writeFile(script, `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))`);
    const p = make(cfg({ mode: 'resident', focusCommand: joinCommand(node, script, 'android-auto') }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    await p.launch();
    expect(p.state.get().status).toBe('active');
    expect(JSON.parse(await read(out))).toEqual(['android-auto']);
  });

  it('does not claim success when the app died while the focus hook was running', async () => {
    const pidFile = join(dir, 'app.pid');
    const p = make(
      cfg({
        mode: 'resident',
        args: ['-e', `require('fs').writeFileSync('${pidFile}',String(process.pid));${LONG}`],
        focusCommand: slowHook(join(dir, 'focus'), 400),
      }),
    );
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    const pid = await readPid(pidFile);
    const launching = p.launch();
    await waitFor(() => p.state.get().status === 'starting', 'starting');
    process.kill(pid, 'SIGKILL');
    await launching;
    expect(p.state.get().status).not.toBe('active'); // it used to flip to 'active' with the app gone
    await waitFor(() => p.state.get().running && p.state.get().status === 'idle', 'restarted and idle');
  });

  it('dispose cancels a hook that is still running and leaves the state alone', async () => {
    const f = join(dir, 'focus');
    const p = make(cfg({ mode: 'resident', focusCommand: slowHook(f, 400) }));
    p.start();
    await waitFor(() => p.state.get().running, 'running');
    const launching = p.launch();
    await waitFor(() => p.state.get().status === 'starting', 'starting');
    p.dispose();
    await launching;
    await sleep(700); // longer than the hook would have taken
    expect(await read(f)).toBe(''); // the hook was killed, not left to finish
    expect(p.state.get().status).toBe('starting'); // nothing was reported after dispose
  });
});

describe('external projection — resident: launcher hand-off', () => {
  const handoffApp = (log: string) => ['-e', `require('fs').appendFileSync('${log}','s')`]; // starts, "hands off", exits 0

  it('does not restart a launcher that exits cleanly right after start', async () => {
    const log = join(dir, 'starts');
    const f = join(dir, 'focus'), b = join(dir, 'back');
    const p = make(cfg({ mode: 'resident', args: handoffApp(log), focusCommand: hook(f, 'raised'), backCommand: hook(b, 'lowered') }));
    p.start();
    await waitFor(async () => (await read(log)) === 's', 'first start');
    await sleep(300); // far longer than the 20 ms restart delay
    expect(await read(log)).toBe('s'); // one start, no restart loop
    expect(p.state.get()).toMatchObject({ status: 'idle', running: true });
    expect(p.state.get().detail).toBeUndefined();
    await p.launch();
    expect(p.state.get().status).toBe('active');
    await p.stop();
    expect(p.state.get().status).toBe('idle');
  });

  it('still restarts an app that exits cleanly after it had been running for a while', async () => {
    const log = join(dir, 'starts');
    const p = make(cfg({ mode: 'resident', args: handoffApp(log) }), { handoffMs: 0 });
    p.start();
    await waitFor(async () => (await read(log)).length >= 2, 'a restart'); // a launcher that quit "late" is not a hand-off
  });

  it('starts the app again when Launch cannot find the handed-off window', async () => {
    const log = join(dir, 'starts');
    const script = join(dir, 'focus.js');
    // Like focus-window.sh: wait a little for the window (here: for a second start), exit 1 if it never shows up.
    await writeFile(
      script,
      `const fs=require('fs');const end=Date.now()+700;(function t(){if(fs.existsSync(${JSON.stringify(log)})&&fs.readFileSync(${JSON.stringify(log)},'utf8').length>=2)process.exit(0);if(Date.now()>end)process.exit(1);setTimeout(t,20)})()`,
    );
    const p = make(cfg({ mode: 'resident', args: handoffApp(log), focusCommand: joinCommand(node, script) }));
    p.start();
    await waitFor(async () => (await read(log)) === 's', 'first start');
    await sleep(100);
    await p.launch();
    expect(await read(log)).toBe('ss'); // started once more, exactly once
    expect(p.state.get().status).toBe('active');
  });

  it('does not start the app again when the focus helper itself is broken', async () => {
    const log = join(dir, 'starts');
    const p = make(cfg({ mode: 'resident', args: handoffApp(log), focusCommand: `"${node}" -e "process.exit(127)"` }));
    p.start();
    await waitFor(async () => (await read(log)) === 's', 'first start');
    await sleep(100);
    await p.launch();
    expect(await read(log)).toBe('s');
    expect(p.state.get().status).toBe('error');
    expect(p.state.get().detail).toContain('exit code 127');
  });
});

describe('external projection — killing the tree', () => {
  it.skipIf(!posix)('escalates to SIGKILL for a descendant that ignores SIGTERM, even though its parent already exited', async () => {
    const pidFile = join(dir, 'stubborn.pid');
    const readyFile = join(dir, 'stubborn.ready');
    const stubborn = `process.on('SIGTERM',()=>{});require('fs').writeFileSync('${readyFile}','1');${LONG}`;
    const script = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'ignore'});require('fs').writeFileSync('${pidFile}',String(c.pid));${LONG}`;
    const p = make(cfg({ args: ['-e', script] }));
    await p.launch();
    const grandchild = await readPid(pidFile);
    try {
      await waitFor(async () => !!(await read(readyFile)), 'SIGTERM handler installed');
      await p.stop(); // SIGTERM: the app dies, the grandchild shrugs it off
      await waitFor(() => p.state.get().status === 'idle', 'app gone');
      await waitFor(() => !alive(grandchild), 'SIGKILL for the grandchild'); // grace is 500 ms
    } finally {
      try {
        process.kill(grandchild, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
  });
});

describe('yieldAudioToProjection', () => {
  const source = (playing: boolean) => {
    const state = new Observable({ playing });
    const calls: unknown[] = [];
    const command = vi.fn(async (c: unknown) => void calls.push(c));
    return { state, command, calls };
  };
  const setup = (radioPlaying: boolean, mediaPlaying: boolean) => {
    const projection = new Observable<ProjectionState>({ provider: 'external', mode: 'resident', running: true, status: 'idle' });
    const radio = source(radioPlaying);
    const media = source(mediaPlaying);
    const off = yieldAudioToProjection(projection, {
      radio: radio as unknown as Pick<RadioProvider, 'state' | 'command'>,
      media: media as unknown as Pick<MediaProvider, 'state' | 'command'>,
    });
    return { projection, radio, media, off };
  };

  it('stops the radio and pauses the music when Android Auto becomes active', () => {
    const { projection, radio, media } = setup(true, true);
    projection.update({ status: 'starting' });
    expect(radio.calls).toEqual([]); // nothing yet: it is only starting
    projection.update({ status: 'active' });
    expect(radio.calls).toEqual([{ cmd: 'stop' }]);
    expect(media.calls).toEqual([{ cmd: 'pause' }]);
  });

  it('acts once per activation, not on every update while it stays active, and never resumes anything', () => {
    const { projection, radio, media } = setup(true, true);
    projection.update({ status: 'active' });
    projection.update({ running: false, status: 'active' }); // e.g. a restart report
    projection.update({ status: 'active' });
    expect(radio.calls).toHaveLength(1);
    expect(media.calls).toHaveLength(1);
    projection.update({ status: 'idle' }); // back to the dashboard: no 'play' of any kind
    expect(radio.calls).toEqual([{ cmd: 'stop' }]);
    expect(media.calls).toEqual([{ cmd: 'pause' }]);
    projection.update({ status: 'active' }); // shown again: yields again
    expect(radio.calls).toHaveLength(2);
    expect(media.calls).toHaveLength(2);
  });

  it('leaves a source that is not playing alone (a sleeping Spotify device is not woken)', () => {
    const { projection, radio, media } = setup(false, false);
    projection.update({ status: 'active' });
    expect(radio.command).not.toHaveBeenCalled();
    expect(media.command).not.toHaveBeenCalled();
  });

  it('only silences what is playing', () => {
    const { projection, radio, media } = setup(false, true);
    projection.update({ status: 'active' });
    expect(radio.calls).toEqual([]);
    expect(media.calls).toEqual([{ cmd: 'pause' }]);
  });

  it('does not act again for an app that was already active when it was wired up, and can be unsubscribed', () => {
    const projection = new Observable<ProjectionState>({ provider: 'external', mode: 'ondemand', running: false, status: 'active' });
    const radio = source(true);
    const media = source(true);
    const off = yieldAudioToProjection(projection, {
      radio: radio as unknown as Pick<RadioProvider, 'state' | 'command'>,
      media: media as unknown as Pick<MediaProvider, 'state' | 'command'>,
    });
    projection.update({ detail: 'x' });
    expect(radio.command).not.toHaveBeenCalled();
    off();
    projection.update({ status: 'idle' });
    projection.update({ status: 'active' });
    expect(radio.command).not.toHaveBeenCalled();
  });

  it('survives a source that refuses the command', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { projection, media } = setup(false, true);
    media.command.mockRejectedValueOnce(new Error('device asleep'));
    projection.update({ status: 'active' });
    await sleep(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('works with the simulated projection used on Windows/dev', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockProjection();
      const radio = source(true);
      const media = source(true);
      yieldAudioToProjection(mock.state, {
        radio: radio as unknown as Pick<RadioProvider, 'state' | 'command'>,
        media: media as unknown as Pick<MediaProvider, 'state' | 'command'>,
      });
      await mock.launch();
      expect(media.command).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1300);
      expect(radio.calls).toEqual([{ cmd: 'stop' }]);
      expect(media.calls).toEqual([{ cmd: 'pause' }]);
      mock.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
