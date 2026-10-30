/**
 * deploy/setup-fm.sh, run for real against a staged root (HEADUNIT_FM_ROOT): a copy of the project in a temp folder, a fake
 * /proc/device-tree, a stub for `make` in most tests and the real `make` in one. Nothing outside the temp folders is touched, and the
 * transmitter program is never run (the installer itself runs `-v` only, which prints the version and touches no hardware).
 * Needs bash and python3; the real-build tests also need make and g++.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FM_PROTOCOL } from '@headunit/shared';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The installer under test (set FM_SETUP_PATH to try another copy of it, as the mutation checks do). */
const SETUP_SCRIPT = process.env.FM_SETUP_PATH || join(REPO, 'deploy', 'setup-fm.sh');

function hasCommand(command: string, args: string[] = ['--version']): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
const toolsAvailable = hasCommand('bash') && hasCommand('python3');
const canBuild = toolsAvailable && hasCommand('make') && hasCommand('g++') && hasCommand('sha256sum');
if (!toolsAvailable) console.warn('installer.test.ts: bash or python3 was not found, so the FM installer tests are skipped');

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const PI4 = Buffer.from('Raspberry Pi 4 Model B Rev 1.4\0');
const PI4_RANGES = Buffer.from('7e000000' + '00000000' + 'fe000000' + '01800000', 'hex');
const PI3 = Buffer.from('Raspberry Pi 3 Model B Plus Rev 1.3\0');
const PI3_RANGES = Buffer.from('7e000000' + '3f000000' + '01000000', 'hex');
const PI5 = Buffer.from('Raspberry Pi 5 Model B Rev 1.0\0');
const PI5_RANGES = Buffer.from('00000000' + '00000000' + '1000007c' + '00000000', 'hex');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Result {
  code: number | null;
  out: string;
  err: string;
  all: string;
}

/** A project copy, a staged root with a fake device tree, a scratch TMPDIR and a make stub. */
class Stage {
  base = mkdtempSync(join(tmpdir(), 'fm-installer-test-'));
  project = join(this.base, 'project');
  root = join(this.base, 'root');
  tmp = join(this.base, 'tmp');
  stubDir = join(this.base, 'stub');
  stubLog = join(this.stubDir, 'make-calls.log');
  stubEnvLog = join(this.stubDir, 'make-env.log');
  stubRan = join(this.stubDir, 'program-ran.log');
  stubVerified = join(this.stubDir, 'verified.log');
  stub = join(this.stubDir, 'make');
  fakeBin = join(this.base, 'fakebin');
  systemctlLog = join(this.base, 'systemctl.log');
  systemctlActive = join(this.base, 'systemctl-active');

  constructor(board: { model: Buffer | null; ranges: Buffer | null } = { model: PI4, ranges: PI4_RANGES }) {
    dirs.push(this.base);
    mkdirSync(this.tmp);
    mkdirSync(this.stubDir);
    cpSync(SETUP_SCRIPT, join(this.project, 'deploy', 'setup-fm.sh'));
    cpSync(join(REPO, 'deploy', 'fm-node'), join(this.project, 'deploy', 'fm-node'), { recursive: true, filter: (src) => !src.includes('__pycache__') });
    cpSync(join(REPO, 'vendor', 'fm_transmitter'), join(this.project, 'vendor', 'fm_transmitter'), { recursive: true });
    this.setBoard(board.model, board.ranges);
    this.writeStub();
    this.writeSystemctl();
  }

  get script(): string {
    return join(this.project, 'deploy', 'setup-fm.sh');
  }
  get lib(): string {
    return join(this.root, 'usr', 'local', 'lib', 'headunit-fm');
  }
  get conf(): string {
    return join(this.root, 'etc', 'headunit-fm-node.conf');
  }
  get unit(): string {
    return join(this.root, 'etc', 'systemd', 'system', 'headunit-fm-node.service');
  }
  get envFile(): string {
    return join(this.project, '.env');
  }

  setBoard(model: Buffer | null, ranges: Buffer | null) {
    const tree = join(this.root, 'proc', 'device-tree');
    mkdirSync(join(tree, 'soc'), { recursive: true });
    rmSync(join(tree, 'model'), { force: true });
    rmSync(join(tree, 'soc', 'ranges'), { force: true });
    if (model) writeFileSync(join(tree, 'model'), model);
    if (ranges) writeFileSync(join(tree, 'soc', 'ranges'), ranges);
  }

  /** A `make` that records how it was called and in what environment, and leaves a fake program that only answers -v. */
  private writeStub() {
    const program = `#!/bin/sh
if [ "$1" = "-v" ]; then echo "$0 version: 0.9.7"; exit 0; fi
echo "the program was run with: $*" >> '${this.stubRan}'
exit 1
`;
    writeFileSync(
      this.stub,
      `#!/bin/bash
echo "$PWD | $*" >> '${this.stubLog}'
env | sort >> '${this.stubEnvLog}'
echo '----' >> '${this.stubEnvLog}'
dir=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-C" ]; then dir="$2"; shift; fi
  shift
done
if (cd "$dir" && sed -n 's/^\\([0-9a-f]\\{64\\}\\)  \\([A-Za-z0-9_.-]*\\)$/\\1  \\2/p' SOURCE.txt | sha256sum -c --quiet - >/dev/null 2>&1); then
  echo "checksums of the build folder: ok" >> '${this.stubVerified}'
else
  echo "checksums of the build folder: MISMATCH" >> '${this.stubVerified}'
fi
cat > "$dir/fm_transmitter" <<'PROGRAM'
${program}PROGRAM
chmod +x "$dir/fm_transmitter"
`,
      { mode: 0o755 },
    );
    chmodSync(this.stub, 0o755);
  }

  /** A `systemctl` for PATH that records its calls and keeps a little state: enable --now makes the unit active, disable --now stops it. */
  private writeSystemctl(failToStay = false) {
    mkdirSync(this.fakeBin, { recursive: true });
    writeFileSync(
      join(this.fakeBin, 'systemctl'),
      `#!/bin/bash
echo "$*" >> '${this.systemctlLog}'
case "$1" in
  is-active) [ -e '${this.systemctlActive}' ] ;;
  enable) case " $* " in *" --now "*) ${failToStay ? ':' : `touch '${this.systemctlActive}'`} ;; esac ;;
  disable) rm -f '${this.systemctlActive}' ;;
  *) : ;;
esac
`,
      { mode: 0o755 },
    );
  }

  /** Makes the unit never stay active after `enable --now`, as when the helper crashes on start. */
  breakSystemctl() {
    this.writeSystemctl(true);
  }

  get systemctlCalls(): string[] {
    return existsSync(this.systemctlLog) ? readFileSync(this.systemctlLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  }

  get makeCalls(): string[] {
    return existsSync(this.stubLog) ? readFileSync(this.stubLog, 'utf8').trim().split('\n').filter(Boolean) : [];
  }

  run(args: string[], env: Record<string, string> = {}, options: { real?: boolean; unstaged?: boolean; systemctl?: boolean } = {}): Result {
    const base: Record<string, string> = { PATH: process.env.PATH ?? '', TMPDIR: this.tmp, LANG: 'C' };
    if (options.systemctl) {
      base.PATH = `${this.fakeBin}:${base.PATH}`; // the stub first; the real systemctl is never reached
      base.HEADUNIT_FM_SKIP_SYSTEMCTL = '0';
    }
    if (!options.unstaged) base.HEADUNIT_FM_ROOT = this.root;
    if (!options.real && !options.unstaged) base.HEADUNIT_FM_MAKE = this.stub;
    const done = spawnSync('bash', [this.script, ...args], { env: { ...base, ...env }, encoding: 'utf8', timeout: 120_000 });
    return { code: done.status, out: done.stdout, err: done.stderr, all: done.stdout + done.stderr };
  }

  /** Every file under the staged root except the fake device tree, relative to it. */
  installedFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else found.push(full.slice(this.root.length + 1));
      }
    };
    if (existsSync(this.root)) walk(this.root);
    return found.filter((f) => !f.startsWith('proc/')).sort();
  }

  token(): string {
    return /^TOKEN=(.*)$/m.exec(readFileSync(this.conf, 'utf8'))?.[1] ?? '';
  }
}

const mode = (path: string) => statSync(path).mode & 0o777;

describe.skipIf(!toolsAvailable)('setup-fm.sh: boards that must be refused', () => {
  it('refuses a Pi 5 in both modes, says why, and installs, builds and enables nothing', () => {
    for (const modeName of ['local', 'node']) {
      const stage = new Stage({ model: PI5, ranges: PI5_RANGES });
      const r = stage.run([modeName]);
      expect(r.code, r.all).toBe(1);
      expect(r.all).toContain('Raspberry Pi 5');
      expect(r.all).toContain('second Pi');
      expect(stage.installedFiles(), 'nothing may be installed').toEqual([]);
      expect(stage.makeCalls, 'nothing may be built').toEqual([]);
      expect(existsSync(stage.stubRan)).toBe(false);
      expect(readdirSync(stage.tmp), 'no temporary build folder is left behind').toEqual([]);
      expect(existsSync(stage.envFile)).toBe(false);
    }
  });

  it('refuses a board it does not recognise, cannot read, or whose address does not match its name', () => {
    const cases: Array<[string, Buffer | null, Buffer | null]> = [
      ['no device tree at all', null, null],
      ['an unknown board', Buffer.from('Orange Pi 5\0'), PI4_RANGES],
      ['a Pi 4 with no address list', PI4, null],
      ['a Pi 4 with a Pi 3 address', PI4, PI3_RANGES],
      ['a Pi 3 with a Pi 4 address', PI3, PI4_RANGES],
      ['a Pi 500', Buffer.from('Raspberry Pi 500 Rev 1.0\0'), PI4_RANGES],
      ['a compute module 5', Buffer.from('Raspberry Pi Compute Module 5 Rev 1.0\0'), PI4_RANGES],
      ['a name with a command in it', Buffer.from('Raspberry Pi 4 Model B Rev 1.4; touch /tmp/fm-installer-pwned\0'), PI4_RANGES],
    ];
    for (const [label, model, ranges] of cases) {
      for (const modeName of ['local', 'node']) {
        const stage = new Stage({ model, ranges });
        const r = stage.run([modeName]);
        expect(r.code, `${label} (${modeName}): ${r.all}`).toBe(1);
        expect(stage.installedFiles(), label).toEqual([]);
        expect(stage.makeCalls, label).toEqual([]);
      }
    }
    expect(existsSync('/tmp/fm-installer-pwned')).toBe(false);
  });

  it('tells a head unit that is a Pi 5 to use `node` on a second Pi, and a refused `node` Pi to use a Zero, 3 or 4', () => {
    const stage = new Stage({ model: PI5, ranges: PI5_RANGES });
    expect(stage.run(['local']).all).toMatch(/setup-fm\.sh node/);
    expect(stage.run(['node']).all).toMatch(/Zero, 2, 3 or 4/);
  });

  // This one runs the installer WITHOUT a staged root, so the only thing between it and the real /usr/local and /etc is the board check
  // itself. It is skipped on a machine that already has an install (or is a Pi), and if the check ever lets it through it cleans up.
  const REAL_PATHS = ['/usr/local/lib/headunit-fm', '/etc/headunit-fm-node.conf', '/etc/systemd/system/headunit-fm-node.service'];
  it.skipIf(existsSync('/proc/device-tree/model') || REAL_PATHS.some((p) => existsSync(p)))(
    'ignores the test switches when the root is not staged (the real board check cannot be faked from the environment)',
    () => {
      const stage = new Stage();
      try {
        const r = stage.run(
          ['local'],
          {
            HEADUNIT_FM_MODEL_FILE: join(stage.root, 'proc', 'device-tree', 'model'),
            HEADUNIT_FM_RANGES_FILE: join(stage.root, 'proc', 'device-tree', 'soc', 'ranges'),
            HEADUNIT_FM_MAKE: stage.stub,
            HEADUNIT_FM_SKIP_APT: '1', // these two are harmless and honoured everywhere, so a failure here cannot start a real service
            HEADUNIT_FM_SKIP_SYSTEMCTL: '1',
          },
          { unstaged: true },
        );
        expect(r.code, r.all).toBe(1);
        expect(r.all).toContain('Ignoring HEADUNIT_FM_MODEL_FILE');
        expect(r.all).toContain('Ignoring HEADUNIT_FM_RANGES_FILE');
        expect(r.all).toContain('Ignoring HEADUNIT_FM_MAKE');
        expect(stage.makeCalls).toEqual([]);
        for (const p of REAL_PATHS) expect(existsSync(p), p).toBe(false);
      } finally {
        for (const p of REAL_PATHS) rmSync(p, { recursive: true, force: true });
      }
    },
  );
});

describe.skipIf(!toolsAvailable)('setup-fm.sh: installing', () => {
  it('node on a Pi 4: puts every file where the service expects it, with the right modes, and a fresh password', () => {
    const stage = new Stage();
    const r = stage.run(['node']);
    expect(r.code, r.all).toBe(0);
    expect(stage.installedFiles()).toEqual([
      'etc/headunit-fm-node.conf',
      'etc/systemd/system/headunit-fm-node.service',
      'usr/local/lib/headunit-fm/build.stamp',
      'usr/local/lib/headunit-fm/fm_node.py',
      'usr/local/lib/headunit-fm/fm_transmitter',
    ]);
    expect(mode(stage.conf)).toBe(0o600);
    expect(mode(join(stage.lib, 'fm_node.py'))).toBe(0o755);
    expect(mode(join(stage.lib, 'fm_transmitter'))).toBe(0o755);
    expect(mode(stage.lib)).toBe(0o755);
    expect(mode(stage.unit)).toBe(0o644);
    expect(readFileSync(join(stage.lib, 'fm_node.py'))).toEqual(readFileSync(join(REPO, 'deploy', 'fm-node', 'fm_node.py')));
    expect(readFileSync(stage.unit)).toEqual(readFileSync(join(REPO, 'deploy', 'fm-node', 'headunit-fm-node.service')));
    const token = stage.token();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const conf = readFileSync(stage.conf, 'utf8');
    expect(conf).toMatch(/^BIND=0\.0\.0\.0$/m); // a second Pi must be reachable
    expect(conf).toMatch(/^BIN=\/usr\/local\/lib\/headunit-fm\/fm_transmitter$/m); // the real system path, not the staged one
    expect(conf).toMatch(/^FREQ_MIN=87\.5$/m);
    expect(conf).toMatch(/^FREQ_MAX=108\.0$/m);
  });

  it('builds a copy in a temporary folder with the documented flags, in a clean environment, and leaves no build products behind', () => {
    const stage = new Stage();
    const before = readdirSync(join(stage.project, 'vendor', 'fm_transmitter')).sort();
    const r = stage.run(['node'], { CXXFLAGS: '-DEVIL', CPATH: '/nonexistent', MAKEFLAGS: '-e' });
    expect(r.code, r.all).toBe(0);
    expect(stage.makeCalls).toHaveLength(1);
    const call = stage.makeCalls[0] ?? '';
    expect(call).toContain('-C ');
    expect(call).toContain('CXXFLAGS=-Wall -O3 -std=c++11');
    expect(call).not.toContain('GPIO21');
    const buildDir = /-C (\S+)/.exec(call)?.[1] ?? '';
    expect(buildDir.startsWith(stage.tmp)).toBe(true); // it builds in a folder made under TMPDIR...
    expect(buildDir.startsWith(stage.project)).toBe(false); // ...never in the project
    expect(readdirSync(join(stage.project, 'vendor', 'fm_transmitter')).sort(), 'the vendored source folder is untouched').toEqual(before);
    expect(readdirSync(stage.tmp), 'the temporary build folder is removed').toEqual([]);
    const env = readFileSync(stage.stubEnvLog, 'utf8');
    expect(env).not.toContain('EVIL');
    expect(env).not.toContain('MAKEFLAGS');
    expect(env).not.toContain('CPATH');
    expect(existsSync(stage.stubRan), 'only -v may ever be run').toBe(false);
  });

  it('--gpio21 builds with -DGPIO21 and says pin 40; the default says GPIO4, pin 7', () => {
    const stage = new Stage();
    const plain = stage.run(['node']);
    expect(plain.code, plain.all).toBe(0);
    expect(plain.out).toContain('GPIO4 (pin 7)');
    expect(stage.makeCalls[0]).not.toContain('GPIO21');
    const stage2 = new Stage();
    const r = stage2.run(['node', '--gpio21']);
    expect(r.code, r.all).toBe(0);
    expect(stage2.makeCalls).toHaveLength(1);
    expect(stage2.makeCalls[0]).toContain('CXXFLAGS=-Wall -O3 -std=c++11 -DGPIO21');
    expect(r.out).toContain('GPIO21 (pin 40)');
    expect(r.out).not.toContain('GPIO4 (pin 7)');
  });

  it('node prints the head unit\'s two .env lines with the real password, plus the antenna and the legal reminder', () => {
    const stage = new Stage();
    const r = stage.run(['node']);
    const token = stage.token();
    expect(r.out).toMatch(/^ {2}FM_NODE_URL=http:\/\/\S+:8788$/m);
    expect(r.out).toContain(`  FM_NODE_TOKEN=${token}`);
    expect(r.out).toMatch(/20 to 40 cm of plain wire/);
    expect(r.out).toMatch(/no amplifier/i);
    expect(r.out).toMatch(/needs permission in many countries/);
    expect(r.out).toContain('docs/fm.md');
  });

  it('local: listens on this Pi only, and writes the two lines into an existing .env without touching the rest, its mode or its owner', () => {
    const stage = new Stage();
    const original = 'PORT=3000\n# my notes\nSPOTIFY_DEVICE_NAME="Car"\nOBD_PORT=/dev/rfcomm0'; // no newline at the end
    writeFileSync(stage.envFile, original, { mode: 0o640 });
    chmodSync(stage.envFile, 0o640);
    const owner = statSync(stage.envFile).uid;
    const r = stage.run(['local']);
    expect(r.code, r.all).toBe(0);
    const token = stage.token();
    expect(readFileSync(stage.conf, 'utf8')).toMatch(/^BIND=127\.0\.0\.1$/m);
    const env = readFileSync(stage.envFile, 'utf8');
    expect(env).toBe(`${original}\nFM_NODE_URL=http://127.0.0.1:8788\nFM_NODE_TOKEN=${token}\n`);
    expect(mode(stage.envFile)).toBe(0o640);
    expect(statSync(stage.envFile).uid).toBe(owner);
    expect(r.out, 'the password is in .env already, so it is not printed').not.toContain(token);
  });

  it('local: never overwrites FM lines that are already in .env, warns if the password differs, and adds only what is missing', () => {
    const stage = new Stage();
    writeFileSync(stage.envFile, 'FM_NODE_URL=http://192.168.4.2:8788\nFM_NODE_TOKEN=somethingelse0123456789\n');
    const same = readFileSync(stage.envFile);
    const r = stage.run(['local']);
    expect(r.code, r.all).toBe(0);
    expect(readFileSync(stage.envFile)).toEqual(same);
    expect(r.all).toContain('WARNING: FM_NODE_TOKEN');
    expect(r.all).not.toContain('somethingelse0123456789');

    const partial = new Stage();
    writeFileSync(partial.envFile, 'FM_NODE_URL=http://10.0.0.5:8788\nOTHER=1\n');
    expect(partial.run(['local']).code).toBe(0);
    const text = readFileSync(partial.envFile, 'utf8');
    expect(text).toBe(`FM_NODE_URL=http://10.0.0.5:8788\nOTHER=1\nFM_NODE_TOKEN=${partial.token()}\n`);
  });

  it('local: without a .env it creates nothing and prints the lines to add', () => {
    const stage = new Stage();
    const r = stage.run(['local']);
    expect(r.code, r.all).toBe(0);
    expect(existsSync(stage.envFile)).toBe(false);
    expect(r.out).toContain('FM_NODE_URL=http://127.0.0.1:8788');
    expect(r.out).toContain(`FM_NODE_TOKEN=${stage.token()}`);
  });

  it('--bind, --freq-min and --freq-max go into the settings file; a later run without them keeps them', () => {
    const stage = new Stage();
    expect(stage.run(['node', '--bind', '192.168.4.2', '--freq-min', '88.1', '--freq-max', '90.15']).code).toBe(0);
    let conf = readFileSync(stage.conf, 'utf8');
    expect(conf).toMatch(/^BIND=192\.168\.4\.2$/m);
    expect(conf).toMatch(/^FREQ_MIN=88\.1$/m);
    expect(conf).toMatch(/^FREQ_MAX=90\.15$/m);
    const again = stage.run(['node']);
    conf = readFileSync(stage.conf, 'utf8');
    expect(conf).toMatch(/^BIND=192\.168\.4\.2$/m);
    expect(conf).toMatch(/^FREQ_MIN=88\.1$/m);
    expect(again.out).toContain('FM_NODE_URL=http://192.168.4.2:8788');
    expect(stage.run(['node', '--bind', '::1']).code).toBe(0);
    expect(readFileSync(stage.conf, 'utf8')).toMatch(/^BIND=::1$/m);
  });

  it('refuses bad option values before it touches anything', () => {
    const bad = [
      ['--bind', 'not-an-ip'], ['--bind', '999.1.1.1'], ['--bind', '0.0.0.0/0'], ['--freq-min', '50'], ['--freq-max', '109'], ['--freq-min', 'abc'],
      ['--freq-max', '90; reboot'], ['--freq-min', '100', '--freq-max', '90'], ['--freq-min', '90', '--freq-max', '90'], ['--nonsense'],
    ];
    for (const extra of bad) {
      const stage = new Stage();
      const r = stage.run(['node', ...extra]);
      expect(r.code, extra.join(' ')).not.toBe(0);
      expect(stage.installedFiles(), extra.join(' ')).toEqual([]);
      expect(stage.makeCalls).toEqual([]);
    }
    expect(new Stage().run([]).code).toBe(2);
    expect(new Stage().run(['sideways']).code).toBe(2);
    expect(new Stage().run(['uninstall', '--gpio21']).code).not.toBe(0);
    expect(new Stage().run(['node', '--purge']).code).not.toBe(0);
  });

  it('is idempotent: a second run keeps the password and the settings, does not build again, and does not duplicate .env lines', () => {
    const stage = new Stage();
    writeFileSync(stage.envFile, 'A=1\n');
    expect(stage.run(['local']).code).toBe(0);
    const token = stage.token();
    const conf = readFileSync(stage.conf);
    const env = readFileSync(stage.envFile);
    const program = readFileSync(join(stage.lib, 'fm_transmitter'));
    const second = stage.run(['local']);
    expect(second.code, second.all).toBe(0);
    expect(stage.token()).toBe(token);
    expect(readFileSync(stage.conf)).toEqual(conf);
    expect(readFileSync(stage.envFile)).toEqual(env);
    expect(readFileSync(join(stage.lib, 'fm_transmitter'))).toEqual(program);
    expect(stage.makeCalls, 'the program is built once').toHaveLength(1);
    expect(second.all).toContain('already built');
    expect(second.all).toContain('Kept the existing password');
    expect(stage.installedFiles()).toHaveLength(5);
    // a different antenna pin is a different build
    const third = stage.run(['local', '--gpio21']);
    expect(third.code, third.all).toBe(0);
    expect(stage.makeCalls).toHaveLength(2);
    expect(stage.makeCalls[1]).toContain('-DGPIO21');
    expect(stage.token()).toBe(token);
  });

  it('puts a damaged or missing password right, and tightens a settings file that was too open', () => {
    const stage = new Stage();
    expect(stage.run(['node']).code).toBe(0);
    const first = stage.token();
    writeFileSync(stage.conf, readFileSync(stage.conf, 'utf8').replace(/^TOKEN=.*$/m, 'TOKEN=short'), { mode: 0o644 });
    chmodSync(stage.conf, 0o644);
    const r = stage.run(['node']);
    expect(r.code, r.all).toBe(0);
    expect(r.all).toContain('made a new one');
    expect(stage.token()).toMatch(/^[0-9a-f]{48}$/);
    expect(stage.token()).not.toBe(first);
    expect(mode(stage.conf)).toBe(0o600);
  });

  it('warns a `node` Pi whose helper listens on loopback only', () => {
    const stage = new Stage();
    const r = stage.run(['node', '--bind', '127.0.0.1']);
    expect(r.code, r.all).toBe(0);
    expect(r.out).toContain('cannot reach it');
  });

  it('what it installs is a working helper: it starts from the installed copy and the installed settings, and answers with the password', async () => {
    const stage = new Stage();
    expect(stage.run(['node']).code).toBe(0);
    const child = spawn(
      'python3',
      ['-B', '-I', join(stage.lib, 'fm_node.py'), '--config', stage.conf, '--bind', '127.0.0.1', '--control-port', '0', '--audio-port', '0',
        '--model-file', join(stage.root, 'proc', 'device-tree', 'model'), '--ranges-file', join(stage.root, 'proc', 'device-tree', 'soc', 'ranges'),
        '--binary', join(stage.lib, 'fm_transmitter')],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '' } },
    );
    try {
      const listening = await new Promise<{ control: number }>((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error('no listening line')), 15_000);
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          if (out.includes('\n')) {
            clearTimeout(timer);
            resolve((JSON.parse(out.split('\n')[0] ?? '{}') as { listening: { control: number } }).listening);
          }
        });
        child.once('exit', (code) => reject(new Error('helper exited ' + code)));
      });
      const ok = await fetch(`http://127.0.0.1:${listening.control}/v1/status`, { headers: { authorization: `Bearer ${stage.token()}` } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ protocol: FM_PROTOCOL, supported: true, state: 'idle', board: 'Raspberry Pi 4 Model B Rev 1.4' });
      const no = await fetch(`http://127.0.0.1:${listening.control}/v1/status`);
      expect(no.status).toBe(401);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
});

describe.skipIf(!toolsAvailable)('setup-fm.sh: the service (with a stub systemctl)', () => {
  const unit = 'headunit-fm-node.service';

  it('reloads systemd, enables and starts the service, and checks that it stays up', () => {
    const stage = new Stage();
    const r = stage.run(['node'], {}, { systemctl: true });
    expect(r.code, r.all).toBe(0);
    expect(stage.systemctlCalls).toEqual(['is-active --quiet ' + unit, 'daemon-reload', 'enable --now ' + unit, 'is-active --quiet ' + unit]);
    expect(r.all).toContain('The helper is running');
  });

  it('restarts a service that was already running, so new code and settings are picked up', () => {
    const stage = new Stage();
    expect(stage.run(['node'], {}, { systemctl: true }).code).toBe(0);
    const again = stage.run(['node'], {}, { systemctl: true });
    expect(again.code, again.all).toBe(0);
    const calls = stage.systemctlCalls.slice(4);
    expect(calls).toEqual(['is-active --quiet ' + unit, 'daemon-reload', 'enable --now ' + unit, 'restart ' + unit, 'is-active --quiet ' + unit]);
  });

  it('--no-start enables the service for the next boot but does not start it', () => {
    const stage = new Stage();
    const r = stage.run(['local', '--no-start'], {}, { systemctl: true });
    expect(r.code, r.all).toBe(0);
    expect(stage.systemctlCalls).toEqual(['is-active --quiet ' + unit, 'daemon-reload', 'enable ' + unit]);
    expect(r.all).toContain('not started');
  });

  it('fails loudly, with where to look, when the service does not stay up', () => {
    const stage = new Stage();
    stage.breakSystemctl();
    const r = stage.run(['node'], {}, { systemctl: true });
    expect(r.code, r.all).toBe(1);
    expect(r.all).toContain('journalctl -u ' + unit);
  });

  it('never touches systemd on a board it refuses', () => {
    const stage = new Stage({ model: PI5, ranges: PI5_RANGES });
    expect(stage.run(['node'], {}, { systemctl: true }).code).toBe(1);
    expect(stage.systemctlCalls).toEqual([]);
  });

  it('uninstall stops and disables it first, and reloads systemd after', () => {
    const stage = new Stage();
    expect(stage.run(['node'], {}, { systemctl: true }).code).toBe(0);
    const before = stage.systemctlCalls.length;
    expect(stage.run(['uninstall'], {}, { systemctl: true }).code).toBe(0);
    expect(stage.systemctlCalls.slice(before)).toEqual(['disable --now ' + unit, 'daemon-reload']);
    expect(existsSync(stage.systemctlActive)).toBe(false);
  });

  it('skips systemd entirely in a staged install unless the test asks for the stub', () => {
    const stage = new Stage();
    const r = stage.run(['node'], { PATH: `${stage.fakeBin}:${process.env.PATH ?? ''}` });
    expect(r.code, r.all).toBe(0);
    expect(stage.systemctlCalls).toEqual([]);
    expect(r.all).toContain('service not enabled');
  });
});

describe.skipIf(!toolsAvailable)('setup-fm.sh: the source check', () => {
  it('stops without building when a vendored file was changed', () => {
    const stage = new Stage();
    writeFileSync(join(stage.project, 'vendor', 'fm_transmitter', 'transmitter.cpp'), readFileSync(join(stage.project, 'vendor', 'fm_transmitter', 'transmitter.cpp'), 'utf8') + '\n// changed\n');
    const r = stage.run(['node']);
    expect(r.code, r.all).toBe(1);
    expect(r.all).toContain('does not match the checksums');
    expect(r.all).toContain('transmitter.cpp');
    expect(stage.installedFiles()).toEqual([]);
    expect(stage.makeCalls).toEqual([]);
  });

  it('stops when a vendored file is missing, when an unlisted file has been added, and when a checksum line has been removed', () => {
    const missing = new Stage();
    rmSync(join(missing.project, 'vendor', 'fm_transmitter', 'mailbox.c'));
    expect(missing.run(['node']).code).toBe(1);
    expect(missing.makeCalls).toEqual([]);

    const extra = new Stage();
    writeFileSync(join(extra.project, 'vendor', 'fm_transmitter', 'extra.c'), 'int main(void){return 0;}\n');
    const e = extra.run(['node']);
    expect(e.code, e.all).toBe(1);
    expect(e.all).toContain('extra.c');
    expect(extra.makeCalls).toEqual([]);

    const trimmed = new Stage();
    const sourceTxt = join(trimmed.project, 'vendor', 'fm_transmitter', 'SOURCE.txt');
    writeFileSync(sourceTxt, readFileSync(sourceTxt, 'utf8').split('\n').filter((l) => !l.endsWith('  wave_reader.cpp')).join('\n'));
    const t = trimmed.run(['node']);
    expect(t.code, t.all).toBe(1);
    expect(t.all).toContain('wave_reader.cpp');
    expect(trimmed.makeCalls).toEqual([]);

    const sub = new Stage();
    mkdirSync(join(sub.project, 'vendor', 'fm_transmitter', 'nested'));
    expect(sub.run(['node']).code).toBe(1);
    expect(sub.makeCalls).toEqual([]);
  });

  it('checks the very copy it builds, so what is compiled is what was verified', () => {
    const stage = new Stage();
    expect(stage.run(['node']).code).toBe(0);
    expect(readFileSync(stage.stubVerified, 'utf8').trim()).toBe('checksums of the build folder: ok');
  });

  it('says when the compiler step itself fails, and installs nothing', () => {
    const stage = new Stage();
    writeFileSync(stage.stub, '#!/bin/bash\necho "cc1plus: error: something went wrong" >&2\nexit 2\n', { mode: 0o755 });
    const r = stage.run(['node']);
    expect(r.code, r.all).toBe(1);
    expect(r.all).toContain('Building the transmitter program failed');
    expect(r.all).toContain('something went wrong');
    expect(stage.installedFiles()).toEqual([]);
    expect(readdirSync(stage.tmp)).toEqual([]);
  });

  it('refuses a build whose program does not run, or reports no version', () => {
    const stage = new Stage();
    writeFileSync(stage.stub, '#!/bin/bash\ndir=""\nwhile [ $# -gt 0 ]; do if [ "$1" = "-C" ]; then dir="$2"; shift; fi; shift; done\nprintf \'#!/bin/sh\\nexit 1\\n\' > "$dir/fm_transmitter"\nchmod +x "$dir/fm_transmitter"\n', { mode: 0o755 });
    const r = stage.run(['node']);
    expect(r.code, r.all).toBe(1);
    expect(r.all).toContain('does not run');
    expect(stage.installedFiles()).toEqual([]);
  });
});

describe.skipIf(!toolsAvailable)('setup-fm.sh: uninstalling', () => {
  it('removes the helper, the program and the service, keeps the password file unless asked, and can be run twice', () => {
    const stage = new Stage();
    expect(stage.run(['node']).code).toBe(0);
    const other = join(stage.root, 'usr', 'local', 'lib', 'someone-else');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'keep.txt'), 'mine');
    const r = stage.run(['uninstall']);
    expect(r.code, r.all).toBe(0);
    expect(stage.installedFiles()).toEqual(['etc/headunit-fm-node.conf', 'usr/local/lib/someone-else/keep.txt']);
    expect(r.all).toContain('--purge');
    expect(stage.run(['uninstall']).code).toBe(0);
    const purge = stage.run(['uninstall', '--purge']);
    expect(purge.code, purge.all).toBe(0);
    expect(stage.installedFiles()).toEqual(['usr/local/lib/someone-else/keep.txt']);
    expect(stage.run(['uninstall', '--purge']).code).toBe(0);
    expect(readFileSync(join(other, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('does not need a supported board (a Pi 5 can clean up)', () => {
    const stage = new Stage({ model: PI5, ranges: PI5_RANGES });
    expect(stage.run(['uninstall']).code).toBe(0);
  });
});

describe.skipIf(!toolsAvailable)('setup-fm.sh and the files it installs: what is written down', () => {
  it('is clean bash, strict, and does not use eval or unquoted rm -rf', () => {
    const script = SETUP_SCRIPT;
    expect(spawnSync('bash', ['-n', script]).status).toBe(0);
    const text = readFileSync(script, 'utf8');
    expect(text).toContain('set -euo pipefail');
    expect(text).not.toMatch(/\beval\b/);
    expect(text).not.toMatch(/rm -rf \$/);
    expect(statSync(script).mode & 0o111, 'executable').not.toBe(0);
    if (hasCommand('shellcheck')) expect(spawnSync('shellcheck', ['-S', 'warning', script], { encoding: 'utf8' }).stdout).toBe('');
  });

  it('the service file carries the hardening the design promises', () => {
    const unit = readFileSync(join(REPO, 'deploy', 'fm-node', 'headunit-fm-node.service'), 'utf8');
    for (const line of [
      'User=root',
      'NoNewPrivileges=yes',
      'CapabilityBoundingSet=CAP_SYS_RAWIO',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'PrivateTmp=yes',
      'DevicePolicy=closed',
      'DeviceAllow=/dev/mem rw',
      'DeviceAllow=/dev/vcio rw',
      'RestrictAddressFamilies=AF_INET AF_INET6',
      'LockPersonality=yes',
      'ProtectKernelTunables=yes',
      'ProtectKernelModules=yes',
      'ProtectControlGroups=yes',
      'Restart=on-failure',
      'RestartSec=5',
      'KillMode=control-group',
    ]) {
      expect(unit.split('\n'), line).toContain(line);
    }
    expect(unit).toMatch(/^ExecStart=\/usr\/bin\/python3 .*\/usr\/local\/lib\/headunit-fm\/fm_node\.py --config \/etc\/headunit-fm-node\.conf$/m);
    expect(unit).not.toMatch(/^DeviceAllow=\/dev\/(?!mem|vcio)/m);
    expect(unit).not.toMatch(/PrivateDevices=yes/); // it needs /dev/mem
  });

  it('the settings example is fully understood by the helper (no unknown key, valid once a password is set)', () => {
    const stage = new Stage();
    const example = readFileSync(join(REPO, 'deploy', 'fm-node', 'fm-node.conf.example'), 'utf8').replace(/^TOKEN=$/m, 'TOKEN=' + 'a'.repeat(32));
    const file = join(stage.base, 'example.conf');
    writeFileSync(file, example, { mode: 0o600 });
    const done = spawnSync('python3', ['-B', '-I', join(REPO, 'deploy', 'fm-node', 'fm_node.py'), '--config', file, '--check-config'], { encoding: 'utf8' });
    expect(done.status, done.stderr).toBe(0);
    expect(done.stderr).toBe(''); // no warning about unknown settings or open permissions
  });
});

describe.skipIf(!canBuild)('setup-fm.sh with the real make (the vendored source, built for real)', () => {
  it('builds the vendored source for real, installs it, and the installed program answers -v; GPIO21 gives a different program', () => {
    const plain = new Stage();
    const first = plain.run(['node'], {}, { real: true });
    expect(first.code, first.all).toBe(0);
    expect(first.all).toContain('Built: fm_transmitter version: 0.9.7');
    const program = join(plain.lib, 'fm_transmitter');
    expect(execFileSync(program, ['-v'], { encoding: 'utf8' })).toContain('version: 0.9.7'); // -v only: it touches no hardware
    expect(readdirSync(plain.tmp), 'no build products are left in TMPDIR').toEqual([]);
    expect(readdirSync(join(plain.project, 'vendor', 'fm_transmitter')).sort()).toEqual(readdirSync(join(REPO, 'vendor', 'fm_transmitter')).sort());

    const again = plain.run(['node'], {}, { real: true });
    expect(again.all).toContain('already built');

    const gpio21 = new Stage();
    const second = gpio21.run(['node', '--gpio21'], {}, { real: true });
    expect(second.code, second.all).toBe(0);
    expect(execFileSync(join(gpio21.lib, 'fm_transmitter'), ['-v'], { encoding: 'utf8' })).toContain('version: 0.9.7');
    expect(readFileSync(join(gpio21.lib, 'fm_transmitter')).equals(readFileSync(program)), 'GPIO21 must change the program').toBe(false);
    expect(readFileSync(join(gpio21.lib, 'build.stamp'), 'utf8')).not.toBe(readFileSync(join(plain.lib, 'build.stamp'), 'utf8'));
  });
});
