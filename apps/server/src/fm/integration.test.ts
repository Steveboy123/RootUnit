/**
 * The FM transmitter end to end: the REAL helper (deploy/fm-node/fm_node.py, a python3 process) and the REAL FmService, with the
 * real routes in front of it, talking over real loopback sockets. Only the edges are fake:
 *
 *  - the transmitter program is a script that records its arguments, environment and stdin (the real fm_transmitter is NEVER run),
 *  - parec is a script that prints a known pattern of sound at about real time, when the test says so,
 *  - the board is a model file in a temp folder (a Pi 4, or a Pi 5 and friends).
 *
 * Needs python3. g++ is used when present, to also run the transmitter program's own wave_reader.cpp over what the helper wrote.
 * Set FM_NODE_PATH to test another copy of fm_node.py (used for the mutation checks).
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FM_NOTICE_VERSION, FM_SAMPLE_RATE, type FmState } from '@headunit/shared';
import { JsonStore } from '../store';
import type { ConnectFn } from './capture';
import { readFmConfig } from './config';
import { createFmRoutes } from './routes';
import { FmService } from './service';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const HELPER = process.env.FM_NODE_PATH || join(REPO, 'deploy', 'fm-node', 'fm_node.py');
const VENDOR = join(REPO, 'vendor', 'fm_transmitter');

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
const pythonAvailable = hasCommand('python3');
if (!pythonAvailable) console.warn('integration.test.ts: python3 was not found, so the FM integration tests are skipped');
const PYTHON = pythonAvailable ? execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim() : 'python3';
const compilerAvailable = hasCommand('g++');

// Real processes, real sockets, real time: allow for a slow or busy machine.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const TOKEN = 'integration-token-0123456789-ABCDEFghij';
const WRONG = 'integration-WRONG-9876543210-zyxwvuTSRQ';

// ---- boards (what /proc/device-tree/model and soc/ranges hold on each) --------------------------------------------------------------
const PI4 = Buffer.from('Raspberry Pi 4 Model B Rev 1.4\0');
const PI4_RANGES = Buffer.from('7e000000' + '00000000' + 'fe000000' + '01800000', 'hex');
const PI5 = Buffer.from('Raspberry Pi 5 Model B Rev 1.0\0');
const PI5_RANGES = Buffer.from('00000000' + '00000000' + '1000007c' + '00000000', 'hex');

const ARGV_100_6 = ['-f', '100.60', '-b', '100', '-d', '0', '-'];
const ON_100_6 = { version: 1, frequency: 100.6, on: true, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } };

/** The 44 bytes the transmitter program's WaveReader accepts for 22050 Hz, mono, 16 bit and a stream of unknown length. */
const EXPECTED_HEADER = Buffer.from(
  '52494646' + 'ffffffff' + '57415645' + '666d7420' + '10000000' + '0100' + '0100' + '22560000' + '44ac0000' + '0200' + '1000' + '64617461' + 'ffffffff',
  'hex',
);

// ---- the known sound -----------------------------------------------------------------------------------------------------------------
/**
 * Sample `k` of the pattern parec prints for segment `segment`: never zero (so it cannot be mistaken for silence) and different
 * from its neighbours, so a shifted, repeated, reordered or half-cut sample shows up. Python's twin is in FAKE_PAREC.
 */
const sampleAt = (segment: number, k: number): number => 1 + ((Math.imul(segment * 1_000_000 + k, 2654435761) >>> 0) % 30000);
/** After each pattern parec prints this much of a constant, so that the helper's last 100 ms of waiting sound is pushed out. */
const PAD_VALUE = 3;
const PAD_SAMPLES = 6615;

interface Segment {
  segment: number;
  samples: number;
}

/** Records how it was started and ends when its owner is gone; prints nothing until the test writes play-N. */
const FAKE_PAREC = String.raw`#!@PYTHON@
import os, struct, sys, time, json
PM = @PM@
SECRETS = @SECRETS@
parent = os.getppid()
with open("/proc/self/environ", "rb") as handle:
    environ = handle.read().decode("latin1")
info = {"argv": sys.argv[1:], "pid": os.getpid(), "tokenInEnv": any(s in environ for s in SECRETS),
        "envNames": [item.split("=", 1)[0] for item in environ.split("\0") if item]}
name = os.path.join(PM, "parec-%020d-%d.json" % (time.time_ns(), os.getpid()))
with open(name + ".tmp", "w") as handle:
    handle.write(json.dumps(info))
os.rename(name + ".tmp", name)
done = [int(n[5:]) for n in os.listdir(PM) if n.startswith("done-")]
segment = max(done or [0])
PIECES = [1001, 640, 883, 882]   # odd sizes on purpose: the sound is cut anywhere, in the middle of a sample too
piece = 0
while True:
    if os.getppid() != parent:
        os._exit(0)
    play = os.path.join(PM, "play-%d" % (segment + 1))
    if not os.path.exists(play):
        time.sleep(0.01)
        continue
    segment += 1
    with open(play) as handle:
        total = int(handle.read().strip())
    values = [1 + (((segment * 1000000 + k) * 2654435761) & 0xFFFFFFFF) % 30000 for k in range(total)] + [@PAD_VALUE@] * @PAD_SAMPLES@
    data = struct.pack("<%dh" % len(values), *values)
    pos = 0
    while pos < len(data):
        size = PIECES[piece % len(PIECES)]
        piece += 1
        chunk = data[pos:pos + size]
        pos += size
        try:
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        except BrokenPipeError:
            os._exit(0)
        time.sleep(len(chunk) / 44100.0)   # never faster than real time
    with open(os.path.join(PM, "done-%d" % segment), "w") as handle:
        handle.write(str(total))
`;

/** A stand-in for fm_transmitter: records what it is given, reads stdin like the real one (a silent second ends it), obeys SIGTERM. */
const FAKE_TRANSMITTER = String.raw`#!@PYTHON@
import json, os, select, signal, sys, time
REC = @REC@
mode = ""
try:
    with open(os.path.join(REC, "mode")) as handle:
        mode = handle.read().strip()
except OSError:
    pass
run = os.path.join(REC, "run-%020d-%d" % (time.time_ns(), os.getpid()))
os.makedirs(run)
def put(name, text):
    with open(os.path.join(run, "." + name), "w") as handle:
        handle.write(text)
    os.rename(os.path.join(run, "." + name), os.path.join(run, name))
with open("/proc/self/environ", "rb") as handle:
    environ = [item for item in handle.read().decode("latin1").split("\0") if item]
put("argv.json", json.dumps(sys.argv[1:]))
put("env.json", json.dumps(environ))
put("cwd", os.getcwd())
put("pid", str(os.getpid()))
def term(*_):
    put("term", repr(time.time()))
    os._exit(0)
signal.signal(signal.SIGTERM, signal.SIG_IGN if mode == "ignore_term" else term)   # a program that will not end when asked
out = open(os.path.join(run, "stdin.bin"), "ab", buffering=0)
print("Broadcasting at", sys.argv[2], "MHz with", sys.argv[4], "kHz bandwidth")
sys.stdout.flush()
while True:
    ready, _, _ = select.select([0], [], [], 1.0)
    if not ready:
        put("starved", repr(time.time()))   # upstream: a silent second is the end of the stream
        sys.exit(0)
    data = os.read(0, 65536)
    if not data:
        put("eof", repr(time.time()))
        if mode != "ignore_term":
            sys.exit(0)
        while True:
            time.sleep(1)   # upstream does not stop at the end of its input either: only a signal that works ends it
    out.write(data)
`;

// ---- small tools ---------------------------------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits (real time) until `check` returns something truthy. A check that throws counts as "not yet". */
async function until<T>(what: string | (() => string), check: () => T | Promise<T>, ms = 20_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    try {
      const value = await check();
      if (value) return value as NonNullable<T>;
      last = '';
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= end) throw new Error(`timed out after ${ms} ms waiting for ${typeof what === 'function' ? what() : what}${last ? ` (${last})` : ''}`);
    await sleep(25);
  }
}

function alive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function captureConsole(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => {
    lines.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(grab));
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}

// ---- what the transmitter program was given ------------------------------------------------------------------------------------------
interface Run {
  dir: string;
  argv: string[];
  env: string[];
  cwd: string;
  pid: number;
  stdin: Buffer;
  has(name: string): boolean;
}

function readRun(dir: string): Run {
  const text = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
  const list = (name: string): string[] => {
    const raw = text(name);
    return raw ? (JSON.parse(raw) as string[]) : [];
  };
  return {
    dir,
    get argv() {
      return list('argv.json');
    },
    get env() {
      return list('env.json');
    },
    get cwd() {
      return text('cwd');
    },
    get pid() {
      return Number(text('pid')) || 0;
    },
    get stdin() {
      return existsSync(join(dir, 'stdin.bin')) ? readFileSync(join(dir, 'stdin.bin')) : Buffer.alloc(0);
    },
    has: (name) => existsSync(join(dir, name)),
  };
}

interface ParecRecord {
  argv: string[];
  pid: number;
  tokenInEnv: boolean;
  envNames: string[];
}

/** The sound the program was given, without the header: whole samples only (a write may be in progress), as numbers. */
function samplesOf(stdin: Buffer): number[] {
  const out: number[] = [];
  const end = 44 + ((stdin.length - 44) & ~1);
  for (let at = 44; at < end; at += 2) out.push(stdin.readInt16LE(at));
  return out;
}
const nonzero = (stdin: Buffer): number[] => samplesOf(stdin).filter((v) => v !== 0);

type Match = { kind: 'complete' } | { kind: 'incomplete'; matched: number } | { kind: 'wrong'; index: number; got: number | undefined; expected: string };

/**
 * Is the sound in `stdin` (silence taken out) exactly the patterns of `segments`, in order, each followed by at most its pad? Silence between
 * and around them is free: the helper plays silence whenever the sound runs dry.
 */
function matchStream(stdin: Buffer, segments: Segment[]): Match {
  const values = nonzero(stdin);
  let i = 0;
  for (const { segment, samples } of segments) {
    for (let k = 0; k < samples; k++, i++) {
      if (i >= values.length) return { kind: 'incomplete', matched: i };
      const want = sampleAt(segment, k);
      if (values[i] !== want) return { kind: 'wrong', index: i, got: values[i], expected: `sample ${k} of segment ${segment} = ${want}` };
    }
    for (let pads = 0; pads < PAD_SAMPLES && i < values.length && values[i] === PAD_VALUE; pads++) i++;
  }
  return i === values.length ? { kind: 'complete' } : { kind: 'wrong', index: i, got: values[i], expected: 'nothing more' };
}

/** How much of the patterns arrived, in order, when some may have been dropped: the share found by walking through the stream once. */
function shareFound(stdin: Buffer, segments: Segment[]): number {
  const values = nonzero(stdin);
  let at = 0;
  let found = 0;
  let total = 0;
  for (const { segment, samples } of segments) {
    for (let k = 0; k < samples; k++) {
      total++;
      const want = sampleAt(segment, k);
      let probe = at;
      while (probe < values.length && values[probe] !== want) probe++;
      if (probe < values.length) {
        found++;
        at = probe + 1;
      }
    }
  }
  return total === 0 ? 1 : found / total;
}

// ---- what the transmitter program's WaveReader accepts ---------------------------------------------------------------------------------
interface WaveFormat {
  channels: number;
  sampleRate: number;
  bits: number;
  dataSize: number;
}

/** wave_reader.cpp's checks on the first 44 bytes, as a function: the format, or the reason it would throw. */
function waveReaderAccepts(bytes: Buffer): WaveFormat | string {
  if (bytes.length < 44) return 'fewer than 44 bytes';
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') return 'WAVE file expected';
  if (bytes.toString('latin1', 12, 16) !== 'fmt ' || bytes.readUInt32LE(16) < 16) return 'data corrupted (fmt chunk)';
  const audioFormat = bytes.readUInt16LE(20);
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const byteRate = bytes.readUInt32LE(28);
  const blockAlign = bytes.readUInt16LE(32);
  const bits = bytes.readUInt16LE(34);
  const width = bits >> 3;
  if (audioFormat !== 1 || byteRate !== Math.imul(Math.imul(width, channels), sampleRate) >>> 0 || blockAlign !== width * channels || (width !== 1 && width !== 2)) {
    return 'unsupported WAVE format';
  }
  if (bytes.toString('latin1', 36, 40) !== 'data') return 'data corrupted (data chunk)';
  return { channels, sampleRate, bits, dataSize: bytes.readUInt32LE(40) };
}

const HARNESS = String.raw`
#include "wave_reader.hpp"
#include <cstdio>
#include <cstdlib>
#include <mutex>
int main(int argc, char **argv) {
    std::mutex mtx;
    bool enable = true;
    unsigned buffers = argc > 1 ? std::atoi(argv[1]) : 1;
    try {
        WaveReader reader(std::string(), enable, mtx);
        const WaveHeader &h = reader.GetHeader();
        std::printf("header channels=%u rate=%u bits=%u byteRate=%u blockAlign=%u dataSize=%u\n", h.channels, h.sampleRate, h.bitsPerSample, h.byteRate, h.blockAlign, h.subchunk2Size);
        std::fflush(stdout);
        for (unsigned i = 0; i < buffers; i++) {
            std::vector<Sample> samples = reader.GetSamples(h.sampleRate, enable, mtx);
            double peak = 0;
            for (auto &s : samples) { double v = s.GetMonoValue(); if (v < 0) v = -v; if (v > peak) peak = v; }
            std::printf("buffer %u samples=%zu peak=%.4f\n", i, samples.size(), peak);
            std::fflush(stdout);
            if (samples.size() < h.sampleRate) { std::printf("short\n"); return 3; }
        }
    } catch (std::exception &e) {
        std::printf("error %s\n", e.what());
        return 1;
    }
    return 0;
}
`;

let readerDir: string | null = null;
afterAll(() => {
  if (readerDir) rmSync(readerDir, { recursive: true, force: true });
});

interface RealReader {
  /** Feeds `stream` to the program's own WaveReader and asks it for `buffers` whole seconds. */
  read(stream: Buffer, buffers: number): { code: number | null; out: string };
}
let realReader: RealReader | null | undefined;

/** The program's own wave_reader.cpp compiled into a tiny harness (it only reads stdin: no hardware), or null without g++. */
function compileRealReader(): RealReader | null {
  if (realReader !== undefined) return realReader;
  realReader = null;
  if (!compilerAvailable) {
    process.stderr.write('integration.test.ts: g++ was not found, so the program\'s own WaveReader is not run over the helper\'s stream\n');
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), 'fm-integration-reader-'));
  readerDir = dir;
  for (const name of ['wave_reader.cpp', 'wave_reader.hpp']) copyFileSync(join(VENDOR, name), join(dir, name));
  writeFileSync(join(dir, 'harness.cpp'), HARNESS);
  const exe = join(dir, 'harness');
  const done = spawnSync('g++', ['-std=c++11', '-O1', '-o', exe, join(dir, 'harness.cpp'), join(dir, 'wave_reader.cpp')], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  if (done.status !== 0) {
    process.stderr.write(`integration.test.ts: the WaveReader harness did not compile, so it is not run: ${String(done.stderr).slice(-300)}\n`);
    return null;
  }
  realReader = {
    read(stream, buffers) {
      const ran = spawnSync(exe, [String(buffers)], { input: stream, encoding: 'utf8', timeout: 30_000 });
      return { code: ran.status, out: ran.stdout };
    },
  };
  return realReader;
}

// ---- the helper process ---------------------------------------------------------------------------------------------------------------
class HelperProc {
  child: ChildProcess | null = null;
  control = 0;
  audio = 0;
  /** Everything the helper wrote to stderr (its log), across restarts. */
  log = '';

  constructor(private readonly args: string[]) {}

  launch(ports?: { control: number; audio: number }): Promise<void> {
    const args = ['-B', HELPER, ...this.args, '--control-port', String(ports?.control ?? 0), '--audio-port', String(ports?.audio ?? 0)];
    const child = spawn(PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer) => {
      this.log += chunk.toString('utf8');
    });
    return new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`the helper did not say where it listens: ${this.log}`)), 20_000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the helper exited with ${String(code)}: ${this.log}`));
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        const nl = out.indexOf('\n');
        if (nl < 0) return;
        clearTimeout(timer);
        const listening = (JSON.parse(out.slice(0, nl)) as { listening: { control: number; audio: number } }).listening;
        this.control = listening.control;
        this.audio = listening.audio;
        resolve();
      });
    });
  }

  /** Ends the process with `signal` and waits for it (SIGKILL after `waitMs`). */
  async end(signal: NodeJS.Signals, waitMs = 10_000): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill(signal);
    await Promise.race([exited, sleep(waitMs)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}

// ---- the whole rig -----------------------------------------------------------------------------------------------------------------------
interface RigOptions {
  /** The model file and the hardware address list; null leaves the file out (a machine without a device tree). */
  model?: Buffer | null;
  ranges?: Buffer | null;
  /** More lines for the helper's config file. */
  helperConfig?: string;
  /** The password the head unit has in .env (the helper has TOKEN). */
  serviceToken?: string;
  /** What data/fm.json holds when the head unit starts. */
  file?: unknown;
  /** false: the test starts the head unit's side itself. */
  service?: boolean;
  /** How the fake transmitter program behaves: "ignore_term" does not end when it is asked to. */
  program?: 'ignore_term';
}

interface Reply {
  status: number;
  json: Record<string, unknown>;
  text: string;
}

const opened: Rig[] = [];

class Rig {
  readonly dir = mkdtempSync(join(tmpdir(), 'fm-integration-'));
  readonly rec = join(this.dir, 'rec');
  readonly pm = join(this.dir, 'parec-state');
  readonly bin = join(this.dir, 'bin');
  readonly data = join(this.dir, 'data');
  readonly helper: HelperProc;
  private readonly secrets = [TOKEN, WRONG];
  private readonly serviceToken: string;
  private readonly seedFile: unknown;
  private readonly withService: boolean;

  fm!: FmService;
  store!: JsonStore;
  base = '';
  private readonly services: FmService[] = [];
  private web: HttpServer | null = null;
  private runner: ChildProcess | null = null;
  /** What the head unit process (startRunner) printed, as it stands. */
  private readonly runnerLines: string[] = [];
  private console = captureConsole();
  private segment = 0;

  /** What the head unit asked the helper over HTTP, what it connected to, the states the screens were given, and what the routes said. */
  readonly calls: Array<{ method: string; path: string; body: string }> = [];
  readonly connects: string[] = [];
  readonly states: Array<{ state: FmState; runs: number; connects: number }> = [];
  readonly outputs: string[] = [];

  static async create(options: RigOptions = {}): Promise<Rig> {
    const rig = new Rig(options);
    opened.push(rig);
    await rig.init(options);
    return rig;
  }

  private constructor(options: RigOptions) {
    this.serviceToken = options.serviceToken ?? TOKEN;
    this.seedFile = options.file;
    this.withService = options.service !== false;
    this.helper = new HelperProc([
      '--config',
      join(this.dir, 'fm-node.conf'),
      '--model-file',
      join(this.dir, 'model'),
      '--ranges-file',
      join(this.dir, 'ranges'),
      '--binary',
      join(this.dir, 'fake_transmitter'),
    ]);
  }

  private async init(options: RigOptions): Promise<void> {
    for (const d of [this.rec, this.pm, this.bin, this.data]) mkdirSync(d);
    if (options.model !== null) writeFileSync(join(this.dir, 'model'), options.model ?? PI4);
    if (options.ranges !== null) writeFileSync(join(this.dir, 'ranges'), options.ranges ?? PI4_RANGES);
    const transmitter = join(this.dir, 'fake_transmitter');
    writeFileSync(transmitter, FAKE_TRANSMITTER.replace('@PYTHON@', PYTHON).replace('@REC@', JSON.stringify(this.rec)));
    chmodSync(transmitter, 0o755);
    const parec = join(this.bin, 'parec');
    writeFileSync(
      parec,
      FAKE_PAREC.replace('@PYTHON@', PYTHON)
        .replace('@PM@', JSON.stringify(this.pm))
        .replace('@SECRETS@', JSON.stringify(this.secrets))
        .replace('@PAD_VALUE@', String(PAD_VALUE))
        .replace('@PAD_SAMPLES@', String(PAD_SAMPLES)),
    );
    chmodSync(parec, 0o755);
    if (options.program) writeFileSync(join(this.rec, 'mode'), options.program);
    const config = join(this.dir, 'fm-node.conf');
    writeFileSync(config, `TOKEN=${TOKEN}\n${options.helperConfig ?? ''}\n`, { mode: 0o600 });
    chmodSync(config, 0o600);

    // The head unit's environment: parec is found on the PATH, and its password is in the environment (parec must not get it).
    vi.stubEnv('PATH', `${this.bin}:${process.env.PATH ?? ''}`);
    vi.stubEnv('FM_NODE_TOKEN', this.serviceToken);

    await this.helper.launch();
    this.store = new JsonStore(this.data);
    if (this.seedFile !== undefined) {
      await this.store.write('fm.json', this.seedFile);
      await this.store.flush();
    }
    if (this.withService) await this.startService();
  }

  /** The head unit's side: the real FmService (real fetch, real sockets, parec from the PATH) behind the real routes. */
  async startService(): Promise<void> {
    const config = readFmConfig({
      FM_NODE_TOKEN: this.serviceToken,
      FM_NODE_URL: `http://127.0.0.1:${this.helper.control}`,
      FM_NODE_AUDIO_PORT: String(this.helper.audio),
    });
    const spyFetch: typeof fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      this.calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname, body: typeof init?.body === 'string' ? init.body : '' });
      return fetch(input, init);
    };
    const spyConnect: ConnectFn = (port, host) => {
      this.connects.push(`${host}:${port}`);
      return net.connect({ port, host });
    };
    const fm = new FmService({ store: this.store, config, fetch: spyFetch, connect: spyConnect });
    this.fm = fm;
    this.services.push(fm);
    fm.state.subscribe((state) => this.states.push({ state, runs: this.runs().length, connects: this.connects.length }));
    await fm.start();

    if (this.web) {
      this.web.closeAllConnections();
      await new Promise((resolve) => this.web?.close(resolve));
    }
    const handle = createFmRoutes(fm);
    const web = createHttpServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      handle(req, res, req.method ?? 'GET', path)
        .then((answered) => {
          if (!answered) {
            res.statusCode = 404;
            res.end('{}');
          }
        })
        .catch(() => {
          res.statusCode = 500;
          res.end('{}');
        });
    });
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
    this.web = web;
    this.base = `http://127.0.0.1:${(web.address() as net.AddressInfo).port}`;
  }

  /** The head unit's software is stopped (as at shutdown) and started again, on the same data folder. */
  async restartService(): Promise<void> {
    await this.fm.stop();
    await this.startService();
  }

  // ---- what the screens do ----

  async api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    this.outputs.push(`${method} ${path} -> ${res.status} ${text}`);
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not JSON: the status and the text tell
    }
    return { status: res.status, json, text };
  }

  waitStatus(status: FmState['status'], ms = 30_000): Promise<unknown> {
    return until(() => `the head unit to say "${status}" (it says "${this.fm.state.get().status}": ${this.fm.state.get().detail})`, () => this.fm.state.get().status === status, ms);
  }

  // ---- asking the helper directly (what the head unit would also do, or an attacker) ----

  async helperRequest(method: string, path: string, body?: unknown, token: string | null = TOKEN): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (token !== null) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${this.helper.control}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    for (const secret of this.secrets) expect(text, `the helper's answer to ${method} ${path}`).not.toContain(secret);
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not JSON
    }
    return { status: res.status, json, text };
  }

  /** The helper's own view. Note: with the right password this counts as hearing from the head unit (it feeds the dead-man timer). */
  async helperStatus(): Promise<{ state: string; frequency: number | null; bandwidth: number | null; error: string | null; supported: boolean; audio: { connected: boolean; level: number; underruns: number } }> {
    const reply = await this.helperRequest('GET', '/v1/status');
    expect(reply.status).toBe(200);
    return reply.json as never;
  }

  /** What the helper answers on its sound port to this first line. */
  async audioHello(token: string): Promise<string> {
    const socket = net.connect(this.helper.audio, '127.0.0.1');
    socket.on('error', () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      socket.write(`AUDIO 1 ${token}\n`);
      return await new Promise<string>((resolve) => {
        let data = '';
        const finish = () => {
          clearTimeout(timer);
          resolve(data);
        };
        const timer = setTimeout(finish, 8_000);
        socket.on('data', (chunk: Buffer) => {
          data += chunk.toString('latin1');
          if (data.includes('\n')) finish();
        });
        socket.once('close', finish);
      });
    } finally {
      socket.destroy();
    }
  }

  // ---- the fake transmitter program and the fake parec ----

  runs(): Run[] {
    if (!existsSync(this.rec)) return [];
    return readdirSync(this.rec)
      .filter((n) => n.startsWith('run-'))
      .sort()
      .map((n) => readRun(join(this.rec, n)));
  }

  /** The n-th start of the transmitter program, once it has written its arguments and the helper has sent the header. */
  async run(index: number): Promise<Run> {
    const run = await until(`start number ${index + 1} of the transmitter program (log of the helper: ${this.helper.log.slice(-400)})`, () => {
      const candidate = this.runs()[index];
      return candidate && candidate.argv.length > 0 && candidate.stdin.length >= 44 ? candidate : undefined;
    });
    return run;
  }

  parecs(): ParecRecord[] {
    if (!existsSync(this.pm)) return [];
    return readdirSync(this.pm)
      .filter((n) => n.startsWith('parec-') && n.endsWith('.json'))
      .sort()
      .map((n) => JSON.parse(readFileSync(join(this.pm, n), 'utf8')) as ParecRecord);
  }

  /** parec prints a pattern of `seconds` of sound (then a short pad) at about real time. Resolves when it has printed all of it. */
  async play(seconds: number): Promise<Segment> {
    const segment = ++this.segment;
    const samples = Math.round(seconds * FM_SAMPLE_RATE);
    writeFileSync(join(this.pm, '.play'), String(samples));
    renameSync(join(this.pm, '.play'), join(this.pm, `play-${segment}`));
    await until(`parec to print segment ${segment}`, () => existsSync(join(this.pm, `done-${segment}`)), seconds * 1000 + 40_000);
    return { segment, samples };
  }

  /**
   * Waits until the program's stdin holds exactly these patterns. If the helper itself says it had to drop sound (the machine fell behind),
   * what arrived must still be in order and mostly complete; anything lost without that being said is a failure.
   */
  async expectDelivered(run: Run, segments: Segment[]): Promise<void> {
    const dropped = () => /sound was dropped/.test(this.helper.log);
    const end = Date.now() + 30_000;
    let match = matchStream(run.stdin, segments);
    while (match.kind === 'incomplete' && Date.now() < end) {
      await sleep(50);
      match = matchStream(run.stdin, segments);
    }
    if (match.kind === 'complete') return;
    if (dropped()) {
      await sleep(2_500);
      const share = shareFound(run.stdin, segments);
      process.stderr.write(`integration.test.ts: the helper dropped sound on this busy machine; ${(share * 100).toFixed(1)}% of the pattern arrived, in order\n`);
      expect(share, 'the share of the sound that arrived although the helper dropped some').toBeGreaterThan(0.5);
      return;
    }
    throw new Error(`the sound that reached the transmitter program is not the sound parec printed: ${JSON.stringify(match)}`);
  }

  /** "transmitting" is only ever said when there is a program on the air and a sound connection from a parec that runs. */
  expectHonest(): void {
    for (const { state, runs, connects } of this.states) {
      if (state.status !== 'transmitting') continue;
      expect(runs, 'transmitter programs started when the head unit said "transmitting"').toBeGreaterThanOrEqual(1);
      // (the sound connection is opened only once parec is known to run, so this also says that parec was started)
      expect(connects, 'sound connections opened when the head unit said "transmitting"').toBeGreaterThanOrEqual(1);
    }
  }

  // ---- the head unit's software as its own process (so that it can be killed) ----

  /** Bundles the real FmService with a few lines around it into a program of its own, and starts it. Its output is returned live. */
  async startRunner(): Promise<{ lines: string[]; states: FmState[]; child: ChildProcess }> {
    const fmDir = join(REPO, 'apps', 'server', 'src');
    const entry = join(this.dir, 'runner.ts');
    writeFileSync(
      entry,
      [
        `import { FmService } from ${JSON.stringify(join(fmDir, 'fm', 'service'))};`,
        `import { readFmConfig } from ${JSON.stringify(join(fmDir, 'fm', 'config'))};`,
        `import { JsonStore } from ${JSON.stringify(join(fmDir, 'store'))};`,
        `const fm = new FmService({ store: new JsonStore(process.argv[2] ?? '.'), config: readFmConfig(process.env) });`,
        `fm.state.subscribe((state) => console.log('STATE ' + JSON.stringify(state)));`,
        `await fm.start();`,
        `console.log('READY');`,
        `setInterval(() => undefined, 1 << 30);`,
      ].join('\n'),
    );
    const outfile = join(this.dir, 'runner.mjs');
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile, logLevel: 'silent' });
    const child = spawn(process.execPath, [outfile, this.data], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${this.bin}:${process.env.PATH ?? ''}`,
        HOME: this.dir,
        FM_NODE_TOKEN: this.serviceToken,
        FM_NODE_URL: `http://127.0.0.1:${this.helper.control}`,
        FM_NODE_AUDIO_PORT: String(this.helper.audio),
      },
    });
    this.runner = child;
    const lines = this.runnerLines;
    const states: FmState[] = [];
    let pending = '';
    const take = (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      for (const line of parts) {
        lines.push(line);
        if (line.startsWith('STATE ')) states.push(JSON.parse(line.slice(6)) as FmState);
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    await until('the head unit process to start', () => lines.includes('READY'), 30_000);
    return { lines, states, child };
  }

  // ---- closing everything, and the checks every test ends with ----

  async close(): Promise<void> {
    const problems: string[] = [];
    try {
      for (const service of this.services) await service.stop();
    } catch (err) {
      problems.push(`the head unit could not stop: ${String(err)}`);
    }
    if (this.web) {
      this.web.closeAllConnections();
      await new Promise((resolve) => this.web?.close(resolve));
    }
    if (this.runner && this.runner.exitCode === null && this.runner.signalCode === null) {
      const exited = new Promise<void>((resolve) => this.runner?.once('exit', () => resolve()));
      this.runner.kill('SIGKILL');
      await exited;
    }
    await this.helper.end('SIGTERM');

    // Nothing the test started may be left running. Fake programs that were not told to end by their owner are an error.
    const pids = [...this.runs().map((r) => r.pid), ...this.parecs().map((p) => p.pid)].filter(Boolean);
    try {
      await until('every transmitter program and parec to be gone', () => pids.every((pid) => !alive(pid)), 8_000);
    } catch {
      problems.push(`still running at the end: ${pids.filter(alive).join(', ')}`);
    }
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');

    for (const p of this.parecs()) if (p.tokenInEnv) problems.push('parec was started with the password in its environment');
    // The password is nowhere it should not be.
    for (const [label, text] of this.corpus()) {
      for (const secret of this.secrets) if (text.includes(secret)) problems.push(`the password is in ${label}`);
    }
    this.console.restore();
    vi.unstubAllEnvs();
    rmSync(this.dir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(problems.join('\n'));
  }

  private corpus(): Array<[string, string]> {
    const out: Array<[string, string]> = [
      ['the log of the helper', this.helper.log],
      ['the answers of the routes', this.outputs.join('\n')],
      ['the states the screens were given', this.states.map((s) => JSON.stringify(s.state)).join('\n')],
      ['the log of the head unit', this.console.lines.join('\n')],
      ['the requests the head unit made to the helper (address and body)', this.calls.map((c) => `${c.method} ${c.path} ${c.body}`).join('\n')],
      ['the addresses the head unit connected to', this.connects.join('\n')],
    ];
    out.push(['the output of the head unit process', this.runnerLines.join('\n')]);
    for (const run of this.runs()) out.push([`the arguments and environment of ${basename(run.dir)}`, `${JSON.stringify(run.argv)}\n${JSON.stringify(run.env)}`]);
    for (const p of this.parecs()) out.push(['the arguments of parec', JSON.stringify(p)]);
    if (existsSync(this.data)) for (const name of readdirSync(this.data)) out.push([`data/${name}`, readFileSync(join(this.data, name), 'utf8')]);
    return out;
  }
}

afterEach(async () => {
  const errors: string[] = [];
  for (const rig of opened.splice(0)) {
    try {
      await rig.close();
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
});

/** The header is exactly the 44 bytes a WaveReader accepts, and says what the helper promises: mono, 22050 Hz, 16 bit, unknown length. */
function expectHeader(run: Run): void {
  const head = run.stdin.subarray(0, 44);
  expect(head.toString('hex')).toBe(EXPECTED_HEADER.toString('hex'));
  expect(waveReaderAccepts(head)).toEqual({ channels: 1, sampleRate: FM_SAMPLE_RATE, bits: 16, dataSize: 0xffffffff });
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------------------------------------------------

describe('the check that stands in for the program\'s WaveReader', () => {
  const damaged: Array<[string, number, Buffer]> = [
    ['RIFF', 0, Buffer.from('RIFX')],
    ['WAVE', 8, Buffer.from('WAVX')],
    ['fmt', 12, Buffer.from('fmtX')],
    ['a fmt chunk that is too short', 16, Buffer.from([15, 0, 0, 0])],
    ['not PCM', 20, Buffer.from([3, 0])],
    ['two channels without the rate to match', 22, Buffer.from([2, 0])],
    ['a wrong byte rate', 28, Buffer.from([0x45, 0xac, 0, 0])],
    ['a wrong block size', 32, Buffer.from([3, 0])],
    ['24 bit', 34, Buffer.from([24, 0])],
    ['data', 36, Buffer.from('datX')],
  ];

  it('accepts the header and refuses each of these damaged ones', () => {
    expect(waveReaderAccepts(EXPECTED_HEADER)).toEqual({ channels: 1, sampleRate: 22050, bits: 16, dataSize: 0xffffffff });
    for (const [what, at, bytes] of damaged) {
      const header = Buffer.from(EXPECTED_HEADER);
      bytes.copy(header, at);
      expect(typeof waveReaderAccepts(header), what).toBe('string');
    }
    expect(typeof waveReaderAccepts(EXPECTED_HEADER.subarray(0, 43))).toBe('string');
  });

  it.skipIf(!compilerAvailable)('agrees with the program\'s own wave_reader.cpp about every one of them', () => {
    const reader = compileRealReader();
    if (!reader) return;
    const second = Buffer.alloc(FM_SAMPLE_RATE * 2);
    expect(reader.read(Buffer.concat([EXPECTED_HEADER, second]), 1).code).toBe(0);
    for (const [what, at, bytes] of damaged) {
      const header = Buffer.from(EXPECTED_HEADER);
      bytes.copy(header, at);
      const port = typeof waveReaderAccepts(header) !== 'string';
      expect(reader.read(Buffer.concat([header, second]), 1).code === 0, `${what}: the port says ${port ? 'accepted' : 'refused'}`).toBe(port);
    }
  });

  it('the pattern never starts with a value that could be taken for the pad that follows the one before it', () => {
    for (let segment = 1; segment <= 20; segment++) {
      expect(sampleAt(segment, 0)).not.toBe(PAD_VALUE);
      for (let k = 0; k < 2000; k++) expect(sampleAt(segment, k)).not.toBe(0);
    }
  });
});

describe.skipIf(!pythonAvailable)('the head unit and the FM helper together', () => {
  it('switches on after the notice and transmits at the asked frequency and bandwidth; the program gets a header it accepts, then the sound, then silence', async () => {
    const rig = await Rig.create();

    // The screens' side, as the screens do it.
    expect((await rig.api('POST', '/api/fm/tune', { frequency: 100.6 })).status).toBe(200);
    expect((await rig.api('POST', '/api/fm/acknowledge', { version: FM_NOTICE_VERSION })).status).toBe(200);
    const on = await rig.api('POST', '/api/fm/power', { on: true });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ on: true, acknowledged: true, frequency: 100.6, mode: 'local', demo: false });
    await rig.waitStatus('transmitting');

    // The program was started once, with exactly these arguments, from /, with nothing in its environment.
    const run = await rig.run(0);
    expect(rig.runs()).toHaveLength(1);
    expect(run.argv).toEqual(ARGV_100_6);
    expect(run.cwd).toBe('/');
    expect(run.env).toEqual([]);
    expect(rig.helper.log).toContain('transmitting on 100.60 MHz, bandwidth 100 kHz');
    expect(await rig.helperStatus()).toMatchObject({ state: 'transmitting', frequency: 100.6, bandwidth: 100, supported: true, error: null, audio: { connected: true } });
    expect(rig.fm.state.get()).toMatchObject({ status: 'transmitting', board: 'Raspberry Pi 4 Model B Rev 1.4', limits: { min: 87.5, max: 108 } });

    // parec: started as the spec says, without the password.
    const parec = await until('parec to have written its record', () => rig.parecs()[0]);
    expect(rig.parecs()).toHaveLength(1);
    expect(parec.argv).toEqual(['--device=@DEFAULT_MONITOR@', '--raw', '--rate=22050', '--channels=1', '--format=s16le', '--latency-msec=50']);
    expect(parec.tokenInEnv).toBe(false);
    expect(parec.envNames).not.toContain('FM_NODE_TOKEN');
    // The head unit's sound connection went to the helper's sound port, and only there.
    expect(rig.connects).toEqual([`127.0.0.1:${rig.helper.audio}`]);

    // The header, and the 200 ms of silence in front of the first sound.
    expectHeader(run);
    await until('the first 200 ms of silence', () => run.stdin.length >= 44 + 8820);
    expect(run.stdin.subarray(44, 44 + 8820).every((b) => b === 0)).toBe(true);

    // The sound parec prints arrives whole, in order, sample for sample, although it was cut into odd pieces on the way.
    const segment = await rig.play(4.5);
    await until('the level of the sound to be reported', () => rig.states.some((s) => s.state.level > 0.5), 15_000);
    await rig.expectDelivered(run, [segment]);

    // The real WaveReader accepts the whole stream, reads whole seconds from it, and finds the sound in it.
    const reader = compileRealReader();
    if (reader) {
      const stream = run.stdin;
      const buffers = Math.min(8, Math.floor((stream.length - 44) / (FM_SAMPLE_RATE * 2)));
      expect(buffers).toBeGreaterThanOrEqual(4);
      const result = reader.read(stream, buffers);
      expect(result.code, result.out).toBe(0);
      expect(result.out).toContain('header channels=1 rate=22050 bits=16 byteRate=44100 blockAlign=2 dataSize=4294967295');
      expect(result.out).not.toContain('short');
      const peaks = [...result.out.matchAll(/peak=([0-9.]+)/g)].map((m) => Number(m[1]));
      expect(peaks).toHaveLength(buffers);
      expect(Math.max(...peaks)).toBeGreaterThan(0.5);
    }

    // parec has stopped printing. The program must still be fed, in real time, with silence: a silent second would end it.
    await sleep(1_500); // the helper plays out what it was holding
    const bytesBefore = run.stdin.length;
    const t0 = performance.now();
    await sleep(2_500);
    const after = run.stdin;
    const seconds = (performance.now() - t0) / 1000;
    const grew = after.length - bytesBefore;
    expect(grew, 'bytes the program was fed in the silence').toBeGreaterThan(seconds * 44100 * 0.5);
    expect(grew, 'bytes the program was fed in the silence').toBeLessThan(seconds * 44100 * 1.5 + 20_000);
    expect(after.subarray(bytesBefore).every((b) => b === 0)).toBe(true);
    expect(run.has('starved')).toBe(false);
    expect(run.has('eof')).toBe(false);
    expect(run.has('term')).toBe(false);
    expect(alive(run.pid)).toBe(true);
    const status = await rig.helperStatus();
    expect(status.state).toBe('transmitting');
    expect(status.audio.underruns).toBeGreaterThan(0); // it knew the sound had run dry
    expect(rig.fm.state.get().status).toBe('transmitting');
    expect(rig.runs()).toHaveLength(1);
    rig.expectHonest();
  });

  it('retunes while on the air: the program is restarted on the new frequency with a new header, the sound connection stays', async () => {
    const rig = await Rig.create({ file: ON_100_6 });
    await rig.waitStatus('transmitting');
    const first = await rig.run(0);
    expect(first.argv).toEqual(ARGV_100_6);
    const one = await rig.play(1.5);
    await rig.expectDelivered(first, [one]);

    // Three quick taps on "+": one restart of the carrier, not three.
    const t0 = performance.now();
    for (const frequency of [95.5, 95.6, 95.7]) expect((await rig.api('POST', '/api/fm/tune', { frequency })).status).toBe(200);
    const span = performance.now() - t0;
    expect(rig.fm.state.get().frequency).toBe(95.7); // the screen answers at once
    const second = await rig.run(1);
    expect(second.argv).toEqual(['-f', '95.70', '-b', '100', '-d', '0', '-']);
    await until('the old program to be told to end and to be gone', () => first.has('term') && !alive(first.pid));
    expect(first.argv).toEqual(ARGV_100_6);
    if (span < 250) expect(rig.runs(), 'transmitter programs for three quick taps').toHaveLength(2);
    else expect(rig.runs().length).toBeLessThanOrEqual(4);

    // On the new frequency, on the air, with the same sound connection and the same parec.
    const last = rig.runs().length - 1;
    const current = await rig.run(last);
    expect(current.argv).toEqual(['-f', '95.70', '-b', '100', '-d', '0', '-']);
    await until('the helper and the head unit to agree on the new frequency', async () => rig.fm.state.get().status === 'transmitting' && (await rig.helperStatus()).frequency === 95.7);
    expect(rig.helper.log).toContain('retuning to 95.70');
    expect(rig.parecs()).toHaveLength(1);
    expect(rig.connects).toHaveLength(1);
    expect(alive(rig.parecs()[0]!.pid)).toBe(true);

    // The new run has its own header and carries the sound that comes after the retune; the old one got nothing more.
    expectHeader(current);
    const two = await rig.play(1.5);
    await rig.expectDelivered(current, [two]);
    expect(matchStream(first.stdin, [one]).kind).toBe('complete');
    expect(first.has('starved')).toBe(false);
    rig.expectHonest();
  });

  it('switching off ends the program (reaped), the sound connection and parec; switching on again starts them all again', async () => {
    const rig = await Rig.create({ file: ON_100_6 });
    await rig.waitStatus('transmitting');
    const run = await rig.run(0);
    const parec = (await until('parec to have started', () => rig.parecs()[0])).pid;
    expect(alive(run.pid)).toBe(true);
    expect(alive(parec)).toBe(true);

    expect((await rig.api('POST', '/api/fm/power', { on: false })).json).toMatchObject({ on: false });
    await until('the program to be told to end and to be gone', () => run.has('term') && !alive(run.pid), 15_000);
    await until('the head unit to say it is ready again', () => rig.fm.state.get().status === 'idle' && /Ready/.test(rig.fm.state.get().detail), 15_000);
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle', frequency: null, bandwidth: null, error: null, audio: { connected: false } });
    await until('parec to be gone', () => !alive(parec), 8_000);
    expect(rig.fm.state.get()).toMatchObject({ on: false, status: 'idle', level: 0 });
    expect(rig.calls.filter((c) => c.method === 'POST' && c.path === '/v1/stop').length).toBeGreaterThanOrEqual(1);

    // It stays off: nothing starts it again by itself.
    await sleep(5_000);
    expect(rig.runs()).toHaveLength(1);
    expect(rig.parecs()).toHaveLength(1);
    expect(rig.calls.filter((c) => c.path === '/v1/start')).toHaveLength(1);
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle' });

    // On again.
    expect((await rig.api('POST', '/api/fm/power', { on: true })).status).toBe(200);
    await rig.waitStatus('transmitting');
    const again = await rig.run(1);
    expect(again.argv).toEqual(ARGV_100_6);
    expectHeader(again);
    await until('the second parec to have written its record', () => rig.parecs().length === 2);
    expect(rig.connects).toHaveLength(2);
    expect(alive(again.pid)).toBe(true);
    const seg = await rig.play(1.5);
    await rig.expectDelivered(again, [seg]);
    rig.expectHonest();
  });

  it('switching off still ends a program that ignores the request to end: it is killed after two seconds, and only then is it off', async () => {
    const rig = await Rig.create({ file: ON_100_6, program: 'ignore_term' });
    await rig.waitStatus('transmitting');
    const run = await rig.run(0);

    const t0 = Date.now();
    expect((await rig.api('POST', '/api/fm/power', { on: false })).status).toBe(200);
    await until('the program that ignores the request to be gone', () => !alive(run.pid), 20_000);
    expect(Date.now() - t0, 'ms until a program that ignores SIGTERM was gone').toBeGreaterThan(1_500);
    expect(run.has('term')).toBe(false); // it never ran its handler: it was killed
    expect(rig.helper.log).toContain('did not stop within 2 seconds and was killed');
    await until('the head unit to say it is ready again', () => rig.fm.state.get().status === 'idle' && /Ready/.test(rig.fm.state.get().detail), 30_000);
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle', frequency: null, error: null, audio: { connected: false } });
    await sleep(2_500);
    expect(rig.runs()).toHaveLength(1);
  });

  it('stopping the head unit switches the carrier off before it returns; starting it again brings the transmitter back by itself', async () => {
    const rig = await Rig.create();
    await rig.api('POST', '/api/fm/tune', { frequency: 100.6 });
    await rig.api('POST', '/api/fm/acknowledge', { version: FM_NOTICE_VERSION });
    await rig.api('POST', '/api/fm/power', { on: true });
    await rig.waitStatus('transmitting');
    const run = await rig.run(0);
    const parec = (await until('parec to have started', () => rig.parecs()[0])).pid;

    await rig.fm.stop();
    // The helper answers the stop only after the program has ended and been reaped.
    expect(alive(run.pid)).toBe(false);
    expect(run.has('term')).toBe(true);
    expect(rig.calls.filter((c) => c.path === '/v1/stop')).toHaveLength(1);
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle', audio: { connected: false } });
    await until('parec to be gone', () => !alive(parec), 8_000);
    // and the head unit says nothing more to the helper
    const seen = rig.calls.length;
    await sleep(2_500);
    expect(rig.calls.length).toBe(seen);

    // The wish "on" was kept in data/fm.json: a new start picks it up.
    await rig.startService();
    expect(rig.fm.state.get()).toMatchObject({ on: true, acknowledged: true, frequency: 100.6 });
    await rig.waitStatus('transmitting');
    const again = await rig.run(1);
    expect(again.argv).toEqual(ARGV_100_6);
    expectHeader(again);
    expect(rig.runs()).toHaveLength(2);
    rig.expectHonest();
  });

  it('follows the limits the helper reports: a narrower band and a lower bandwidth ceiling', async () => {
    const rig = await Rig.create({ helperConfig: 'FREQ_MIN=90\nFREQ_MAX=100\nBANDWIDTH_MAX=60', file: ON_100_6 });
    // 100.6 MHz is outside what this helper may send: said so, and nothing started.
    await rig.waitStatus('error');
    expect(rig.fm.state.get().limits).toEqual({ min: 90, max: 100 });
    expect(rig.fm.state.get().detail).toMatch(/only between 90\.0 and 100\.0 MHz/);
    await sleep(2_500);
    expect(rig.runs()).toEqual([]);
    expect(rig.calls.filter((c) => c.method === 'POST')).toEqual([]);

    const tooHigh = await rig.api('POST', '/api/fm/tune', { frequency: 105 });
    expect(tooHigh.status).toBe(400);
    expect(String(tooHigh.json.error)).toMatch(/between 90\.0 and 100\.0 MHz/);
    expect((await rig.api('POST', '/api/fm/tune', { frequency: 95 })).status).toBe(200);
    await rig.waitStatus('transmitting');
    const run = await rig.run(0);
    expect(run.argv).toEqual(['-f', '95.00', '-b', '60', '-d', '0', '-']);
    expect(JSON.parse(rig.calls.find((c) => c.path === '/v1/start')!.body)).toEqual({ frequency: 95, bandwidth: 60 });
  });
});

describe.skipIf(!pythonAvailable)('the safety rules, with the real helper', () => {
  it('nothing transmits before the notice has been accepted, however it is asked, and a saved "on" from an older notice is not an "on"', async () => {
    const rig = await Rig.create({ file: { ...ON_100_6, ack: { version: FM_NOTICE_VERSION + 1, at: 1 } } });
    await until('the head unit to have looked at the helper', () => /Ready/.test(rig.fm.state.get().detail));
    expect(rig.fm.state.get()).toMatchObject({ on: false, acknowledged: false });

    const refused = await rig.api('POST', '/api/fm/power', { on: true });
    expect(refused.status).toBe(403);
    expect(String(refused.json.error)).toMatch(/notice/);
    expect((await rig.api('POST', '/api/fm/acknowledge', { version: FM_NOTICE_VERSION + 1 })).status).toBe(400);
    expect((await rig.api('POST', '/api/fm/acknowledge', { version: '1' })).status).toBe(400);
    await sleep(3_500); // more than one look at the helper while "on" is still wished by nobody
    expect(rig.fm.state.get()).toMatchObject({ on: false, acknowledged: false });
    expect(rig.runs()).toEqual([]);
    expect(rig.parecs()).toEqual([]);
    expect(rig.connects).toEqual([]);
    expect(rig.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(rig.helper.log).not.toMatch(/transmitting on|audio: client/);

    // Accepting the notice does not switch anything on by itself either.
    expect((await rig.api('POST', '/api/fm/acknowledge', { version: FM_NOTICE_VERSION })).json).toMatchObject({ acknowledged: true, on: false });
    await sleep(2_500);
    expect(rig.runs()).toEqual([]);
    expect(rig.calls.filter((c) => c.method === 'POST' && c.path === '/v1/start')).toEqual([]);

    // Now it can be switched on, and it is.
    expect((await rig.api('POST', '/api/fm/power', { on: true })).status).toBe(200);
    await rig.waitStatus('transmitting');
    expect((await rig.run(0)).argv).toEqual(ARGV_100_6); // the frequency that was saved with it
  });

  it('a wrong password: "error", and the program is never started, no sound is opened, nothing is sent', async () => {
    const rig = await Rig.create({ serviceToken: WRONG, file: ON_100_6 });
    await rig.waitStatus('error');
    expect(rig.fm.state.get().detail).toMatch(/refused the password/);
    await sleep(3_500); // it keeps looking, with pauses
    expect(rig.fm.state.get().status).toBe('error');
    expect(rig.calls.length).toBeGreaterThanOrEqual(2);
    expect(rig.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(rig.connects).toEqual([]);
    expect(rig.parecs()).toEqual([]);
    expect(rig.runs()).toEqual([]);
    expect(rig.helper.log).toContain('wrong or missing password');
    expect(rig.helper.log).not.toMatch(/transmitting on|audio: client/);
    // The helper, asked with its own password, was never told to do anything.
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle', frequency: null, audio: { connected: false } });
    // The same on the sound port: a wrong password gets an ERR and starts nothing.
    expect(await rig.audioHello(WRONG)).toMatch(/^ERR /);
    expect(rig.runs()).toEqual([]);
  });

  const BOARDS: Array<[string, Buffer | null, Buffer | null]> = [
    ['a Raspberry Pi 5', PI5, PI5_RANGES],
    ['a board nobody has heard of', Buffer.from('Orange Pi 5\0'), PI4_RANGES],
    ['a machine with no device tree (an x86 PC)', null, null],
  ];
  it.each(BOARDS)('%s: "unsupported", the program is never started, no sound connection is made, and the helper refuses even when asked directly', async (_name, model, ranges) => {
    const rig = await Rig.create({ model, ranges, file: ON_100_6 });
    await rig.waitStatus('unsupported');
    const unsupported = rig.fm.state.get();
    expect(unsupported.detail.length).toBeGreaterThan(20);
    expect(unsupported.detail).not.toContain(TOKEN);
    if (model === PI5) expect(unsupported).toMatchObject({ board: 'Raspberry Pi 5 Model B Rev 1.0', mode: 'local' });
    await sleep(4_500); // two more looks while "on"
    expect(rig.fm.state.get().status).toBe('unsupported');
    expect(rig.calls.length).toBeGreaterThanOrEqual(2);
    // the head unit only looked: no start, no stop, no sound
    expect(rig.calls.every((c) => c.method === 'GET' && c.path === '/v1/status')).toBe(true);
    expect(rig.connects).toEqual([]);
    expect(rig.parecs()).toEqual([]);
    expect(rig.runs()).toEqual([]);
    expect(rig.helper.log).not.toMatch(/transmitting on|audio: client/);
    expect(rig.helper.log).toContain('will NOT be started');

    // switching it on from a screen: refused, with the reason
    const on = await rig.api('POST', '/api/fm/power', { on: true });
    expect(on.status).toBe(409);
    expect(String(on.json.error)).toBe(unsupported.detail);
    expect((await rig.api('POST', '/api/fm/power', { on: false })).status).toBe(200);

    // and if someone asks the helper itself, with the right password: the same answer, and still no program, no sound
    const status = await rig.helperStatus();
    expect(status).toMatchObject({ supported: false, state: 'idle' });
    for (const body of [{ frequency: 100.6, bandwidth: 100 }, { frequency: 87.5, bandwidth: 25 }, { frequency: 100.6 }]) {
      const reply = await rig.helperRequest('POST', '/v1/start', body);
      expect(reply.status).toBe(403);
      expect(String(reply.json.error).length).toBeGreaterThan(10);
    }
    expect(await rig.audioHello(TOKEN)).toMatch(/^ERR /);
    await sleep(500);
    expect(rig.runs()).toEqual([]);
    expect((await rig.helperStatus()).state).toBe('idle');
  });

  it('the dead-man timer: when the head unit dies without a goodbye, the helper switches the carrier off by itself', async () => {
    const rig = await Rig.create({ helperConfig: 'DEADMAN_S=6', service: false, file: ON_100_6 });
    const head = await rig.startRunner();
    await until('the head unit process to say "transmitting"', () => head.states.some((s) => s.status === 'transmitting'), 40_000);
    const run = await rig.run(0);
    expect(run.argv).toEqual(ARGV_100_6);

    // Alive, it keeps the helper's timer fed with its status requests: the carrier stays on well past the dead-man time.
    await sleep(9_000);
    expect(run.has('term')).toBe(false);
    expect(alive(run.pid)).toBe(true);
    expect(head.states[head.states.length - 1]!.status).toBe('transmitting');
    expect(rig.helper.log).not.toContain('nothing was heard');
    const parec = rig.parecs()[0]!.pid;
    expect(alive(parec)).toBe(true);

    // Killed (no stop request, no goodbye of any kind). From here on the test must not talk to the helper: that would feed the timer.
    const killedAt = Date.now();
    head.child.kill('SIGKILL');
    await until('the helper to switch the carrier off by itself', () => run.has('term') && !alive(run.pid), 6_000 + 25_000);
    const took = Date.now() - killedAt;
    expect(took, 'ms from the death of the head unit to the carrier being off').toBeGreaterThan(1_500);
    expect(rig.helper.log).toContain('nothing was heard from the head unit for 6 seconds');
    expect(rig.runs()).toHaveLength(1);

    // It is idle now, with no error, and it stays that way.
    expect(await rig.helperStatus()).toMatchObject({ state: 'idle', frequency: null, error: null, audio: { connected: false } });
    await sleep(3_000);
    expect(rig.runs()).toHaveLength(1);
    await until('the orphaned parec to end', () => !alive(parec), 8_000);
  });

  it('the helper is killed and comes back: "unreachable", then the transmitter and the sound recover by themselves', async () => {
    const rig = await Rig.create({ file: ON_100_6 });
    await rig.waitStatus('transmitting');
    const first = await rig.run(0);
    const parec = (await until('parec to have started', () => rig.parecs()[0])).pid;
    const ports = { control: rig.helper.control, audio: rig.helper.audio };

    await rig.helper.end('SIGKILL');
    await rig.waitStatus('unreachable', 30_000);
    const gone = rig.fm.state.get();
    expect(gone.detail).toMatch(/does not answer/);
    expect(gone.detail).not.toContain(String(ports.control));
    expect(gone.detail).not.toContain(String(ports.audio));
    expect(gone).toMatchObject({ on: true, level: 0 });
    // (the fake program notices the end of its input; the real one would not, which is why the unit uses KillMode=control-group)
    await until('parec of the lost connection to end', () => !alive(parec), 15_000);
    await sleep(1_500);

    await rig.helper.launch(ports);
    await rig.waitStatus('transmitting', 90_000);
    const runs = rig.runs();
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const second = await rig.run(runs.length - 1);
    expect(second.argv).toEqual(ARGV_100_6);
    expectHeader(second);
    expect(second.dir).not.toBe(first.dir);
    await until('the second parec to have written its record', () => rig.parecs().length >= 2);
    const segment = await rig.play(1.5);
    await rig.expectDelivered(second, [segment]);
    expect(rig.states.some((s) => s.state.status === 'unreachable')).toBe(true);
    rig.expectHonest();
  });
});
