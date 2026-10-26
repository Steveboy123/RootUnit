/**
 * The FM helper (deploy/fm-node/fm_node.py) as the head unit's server meets it: a real python3 process, a FAKE transmitter program
 * (a script that records its arguments, environment and stdin), a fake model file, real sockets. The real fm_transmitter is never run.
 * Needs python3. Set FM_NODE_PATH to test another copy of fm_node.py (used for mutation checks).
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FM_PROTOCOL, FM_SAMPLE_RATE, parseFmNodeStatus } from '@headunit/shared';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const HELPER = process.env.FM_NODE_PATH || join(REPO, 'deploy', 'fm-node', 'fm_node.py');

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
const pythonAvailable = hasCommand('python3');
if (!pythonAvailable) console.warn('helper.test.ts: python3 was not found, so the FM helper tests are skipped');

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const TOKEN = 'vitest-token-0123456789-abcdefABCDEF';
const WRONG = 'vitest-wrong-0123456789-abcdefABCDEF';

const PI4 = Buffer.from('Raspberry Pi 4 Model B Rev 1.4\0');
const PI4_RANGES = Buffer.from('7e000000' + '00000000' + 'fe000000' + '01800000', 'hex');
const PI3 = Buffer.from('Raspberry Pi 3 Model B Plus Rev 1.3\0');
const PI3_RANGES = Buffer.from('7e000000' + '3f000000' + '01000000', 'hex');
const PI_ZERO = Buffer.from('Raspberry Pi Zero W Rev 1.1\0');
const PI_ZERO_RANGES = Buffer.from('7e000000' + '20000000' + '02000000', 'hex');
const PI5 = Buffer.from('Raspberry Pi 5 Model B Rev 1.0\0');
const PI5_RANGES = Buffer.from('00000000' + '00000000' + '1000007c' + '00000000', 'hex');

/** The 44 bytes the transmitter program's WaveReader accepts (see wave_reader.cpp), written out in full. */
const EXPECTED_HEADER = Buffer.from(
  '52494646' + 'ffffffff' + '57415645' + '666d7420' + '10000000' + '0100' + '0100' + '22560000' + '44ac0000' + '0200' + '1000' + '64617461' + 'ffffffff',
  'hex',
);

type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => T | Promise<T>, ms = 10_000, every = 50): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() >= end) return undefined;
    await sleep(every);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A stand-in for fm_transmitter: records what it is given, reads stdin like the real one (a silent second ends it), obeys SIGTERM. */
const FAKE_PROGRAM = String.raw`#!@PYTHON@
import json, os, select, signal, sys, time
REC = @REC@
mode = ""
try:
    mode = open(os.path.join(REC, "mode")).read().strip()
except OSError:
    pass
run = os.path.join(REC, "run-%d-%d" % (time.time_ns(), os.getpid()))
os.makedirs(run)
def put(name, text):
    with open(os.path.join(run, name), "w") as handle:
        handle.write(text)
put("argv.json", json.dumps(sys.argv[1:]))
with open("/proc/self/environ", "rb") as handle:
    raw_env = handle.read()
put("env.json", json.dumps([item for item in raw_env.decode().split("\0") if item]))
put("cwd", os.getcwd())
put("pid", str(os.getpid()))
if mode.startswith("fail:"):
    sys.stderr.write(mode[5:] + "\n")
    sys.stderr.flush()
    sys.exit(1)
if mode == "exit0":
    print("Broadcasting at", sys.argv[2], "MHz with", sys.argv[4], "kHz bandwidth")
    sys.stdout.flush()
    sys.exit(0)
if mode == "ignore_term":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
else:
    def term(*_):
        put("term", str(time.time()))
        os._exit(0)
    signal.signal(signal.SIGTERM, term)
out = open(os.path.join(run, "stdin.bin"), "ab", buffering=0)
times = open(os.path.join(run, "times.log"), "a", buffering=1)
print("Broadcasting at", sys.argv[2], "MHz with", sys.argv[4], "kHz bandwidth")
sys.stdout.flush()
while True:
    ready, _, _ = select.select([0], [], [], 1.0)
    if not ready:
        put("starved", str(time.time()))
        sys.exit(0)
    data = os.read(0, 65536)
    if not data:
        put("eof", str(time.time()))
        sys.exit(0)
    out.write(data)
    times.write("%.3f %d\n" % (time.time(), len(data)))
`;

interface Run {
  dir: string;
  argv: string[];
  pid: number;
  stdin: Buffer;
  has: (name: string) => boolean;
  text: (name: string) => string;
}

function readRun(dir: string): Run {
  const text = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
  return {
    dir,
    get argv() {
      const raw = text('argv.json');
      return raw ? (JSON.parse(raw) as string[]) : [];
    },
    get pid() {
      return Number(text('pid')) || 0;
    },
    get stdin() {
      return existsSync(join(dir, 'stdin.bin')) ? readFileSync(join(dir, 'stdin.bin')) : Buffer.alloc(0);
    },
    has: (name) => existsSync(join(dir, name)),
    text,
  };
}

interface Reply {
  status: number;
  json: Json | null;
  text: string;
  headers: Headers;
}

interface Options {
  model?: Buffer | null;
  ranges?: Buffer | null;
  config?: string;
  args?: string[];
  mode?: string;
  binaryMode?: number;
}

const opened: Fm[] = [];

class Fm {
  dir = mkdtempSync(join(tmpdir(), 'fm-helper-test-'));
  rec = join(this.dir, 'rec');
  binary = join(this.dir, 'fake_transmitter');
  model = join(this.dir, 'model');
  ranges = join(this.dir, 'ranges');
  config = join(this.dir, 'fm-node.conf');
  child!: ChildProcess;
  control = 0;
  audio = 0;
  stderr = '';
  sockets: net.Socket[] = [];

  static async start(options: Options = {}): Promise<Fm> {
    const fm = new Fm();
    opened.push(fm);
    mkdirSync(fm.rec);
    if (options.model !== null) writeFileSync(fm.model, options.model ?? PI4);
    if (options.ranges !== null) writeFileSync(fm.ranges, options.ranges ?? PI4_RANGES);
    writeFileSync(fm.binary, FAKE_PROGRAM.replace('@PYTHON@', pythonPath()).replace('@REC@', JSON.stringify(fm.rec)));
    chmodSync(fm.binary, options.binaryMode ?? 0o755);
    if (options.mode) fm.setMode(options.mode);
    writeFileSync(fm.config, `TOKEN=${TOKEN}\n${options.config ?? ''}\n`, { mode: 0o600 });
    chmodSync(fm.config, 0o600);
    await fm.launch(options.args ?? []);
    return fm;
  }

  setMode(mode: string) {
    writeFileSync(join(this.rec, 'mode'), mode);
  }

  private launch(extra: string[]): Promise<void> {
    const args = ['-B', HELPER, '--config', this.config, '--model-file', this.model, '--ranges-file', this.ranges, '--binary', this.binary,
      '--control-port', '0', '--audio-port', '0', ...extra];
    this.child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '' } });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
    return new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('the helper did not say where it listens: ' + this.stderr)), 15_000);
      this.child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`the helper exited with ${code}: ${this.stderr}`));
      });
      this.child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        const line = out.split('\n')[0];
        if (!out.includes('\n') || line === undefined) return;
        clearTimeout(timer);
        const listening = (JSON.parse(line) as { listening: { control: number; audio: number } }).listening;
        this.control = listening.control;
        this.audio = listening.audio;
        resolve();
      });
    });
  }

  runs(): Run[] {
    return readdirSync(this.rec)
      .filter((n) => n.startsWith('run-'))
      .sort()
      .map((n) => readRun(join(this.rec, n)));
  }

  async request(method: string, path: string, body?: unknown, token: string | null = TOKEN, headers: Record<string, string> = {}): Promise<Reply> {
    const sent: Record<string, string> = { ...headers };
    if (token !== null) sent.authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!('content-type' in sent)) sent['content-type'] = 'application/json';
    }
    const res = await fetch(`http://127.0.0.1:${this.control}${path}`, { method, headers: sent, body: payload, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(WRONG);
    let json: Json | null = null;
    try {
      json = text ? (JSON.parse(text) as Json) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async status(): Promise<Json> {
    const r = await this.request('GET', '/v1/status');
    expect(r.status).toBe(200);
    return r.json ?? {};
  }

  start(frequency: unknown = 100.6, bandwidth: unknown = 100): Promise<Reply> {
    return this.request('POST', '/v1/start', { frequency, bandwidth });
  }

  async audioClient(token: string = TOKEN, hello?: string): Promise<{ socket: net.Socket; reply: string }> {
    const socket = net.connect(this.audio, '127.0.0.1');
    this.sockets.push(socket);
    socket.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    socket.write(hello ?? `AUDIO ${FM_PROTOCOL} ${token}\n`);
    const reply = await readUntilNewlineOrClose(socket, 8_000);
    return { socket, reply };
  }

  async firstRun(): Promise<Run> {
    const run = await until(() => this.runs()[0], 8_000);
    if (!run) throw new Error('the transmitter program was never started: ' + this.stderr);
    await until(() => run.stdin.length >= 44, 8_000);
    return run;
  }

  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
      this.child.kill('SIGTERM');
      const ok = await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)]);
      if (!ok) this.child.kill('SIGKILL');
    }
    if (existsSync(this.rec)) {
      for (const run of this.runs()) if (run.pid && alive(run.pid)) process.kill(run.pid, 'SIGKILL');
    }
    const log = this.stderr;
    rmSync(this.dir, { recursive: true, force: true });
    // the password must never be in the log, right or wrong
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain(WRONG);
  }
}

function pythonPath(): string {
  return execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
}

function readUntilNewlineOrClose(socket: net.Socket, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const finish = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      resolve(data);
    };
    const onData = (chunk: Buffer) => {
      data += chunk.toString('latin1');
      if (data.includes('\n')) finish();
    };
    const timer = setTimeout(finish, ms);
    socket.on('data', onData);
    socket.once('close', finish);
    socket.once('end', finish);
  });
}

/** Sends bytes on a fresh connection and collects everything the helper answers until it hangs up (or `ms` pass). */
function rawExchange(port: number, payload: Buffer | string, ms = 8_000): Promise<{ data: Buffer; hungUp: boolean; took: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    let finished = false;
    let hungUp = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ data: Buffer.concat(chunks), hungUp, took: Date.now() - started });
    };
    const timer = setTimeout(finish, ms);
    sock.on('data', (d: Buffer) => chunks.push(d));
    sock.on('error', () => {
      hungUp = true;
      finish();
    });
    sock.on('close', () => {
      hungUp = true;
      finish();
    });
    sock.on('connect', () => sock.write(payload));
  });
}

function statusLine(data: Buffer): string {
  return data.toString('latin1').split('\r\n')[0] ?? '';
}

function tone(seconds: number, amplitude = 0.5, freq = 440): Buffer {
  const count = Math.floor(seconds * FM_SAMPLE_RATE);
  const out = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) out.writeInt16LE(Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / FM_SAMPLE_RATE)), i * 2);
  return out;
}

afterEach(async () => {
  for (const fm of opened.splice(0)) await fm.close();
});

describe.skipIf(!pythonAvailable)('the FM helper: protocol and contract', () => {
  it('answers /v1/status in the shape the server parses, and says it is protocol 1', async () => {
    const fm = await Fm.start();
    const status = await fm.status();
    expect(status).toEqual({
      protocol: FM_PROTOCOL,
      version: '1.0.0',
      board: 'Raspberry Pi 4 Model B Rev 1.4',
      supported: true,
      reason: null,
      state: 'idle',
      frequency: null,
      bandwidth: null,
      audio: { connected: false, level: 0, underruns: 0 },
      error: null,
      limits: { min: 87.5, max: 108, maxBandwidth: 150 },
      deadmanS: 30,
    });
    const parsed = parseFmNodeStatus(status);
    expect(parsed).not.toBeNull();
    expect(parsed?.protocol).toBe(FM_PROTOCOL);
    expect(parsed?.supported).toBe(true);
    expect(parsed?.limits).toEqual({ min: 87.5, max: 108, maxBandwidth: 150 });
  });

  it('reports what is on the air after a start, as the server will read it', async () => {
    const fm = await Fm.start();
    const r = await fm.start(100.63, 90);
    expect(r.status).toBe(200);
    const parsed = parseFmNodeStatus(r.json);
    expect(parsed).toMatchObject({ state: 'transmitting', frequency: 100.65, bandwidth: 90, error: null });
    expect(parseFmNodeStatus(await fm.status())).toMatchObject({ state: 'transmitting', frequency: 100.65 });
  });

  it('handles routes and methods strictly', async () => {
    const fm = await Fm.start();
    for (const path of ['/', '/v1', '/v1/status/', '/v2/status']) expect((await fm.request('GET', path)).status, path).toBe(404);
    const wrongMethod = await fm.request('POST', '/v1/status', {});
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
    expect((await fm.request('GET', '/v1/start')).status).toBe(405);
    for (const method of ['PUT', 'DELETE', 'PATCH']) expect((await fm.request(method, '/v1/stop')).status, method).toBe(405);
    expect(fm.runs()).toEqual([]);
  });

  it('wants the start body as application/json', async () => {
    const fm = await Fm.start();
    const body = JSON.stringify({ frequency: 100.6, bandwidth: 100 });
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonx']) {
      expect((await fm.request('POST', '/v1/start', body, TOKEN, { 'content-type': type })).status, type).toBe(415);
    }
    expect(fm.runs()).toEqual([]);
    expect((await fm.request('POST', '/v1/start', body, TOKEN, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: password', () => {
  it('turns every request away without the right password, and never starts anything for it', async () => {
    const fm = await Fm.start();
    const body = { frequency: 100.6, bandwidth: 100 };
    for (const [method, path] of [['GET', '/v1/status'], ['POST', '/v1/start'], ['POST', '/v1/stop'], ['GET', '/nothing'], ['DELETE', '/v1/status']] as const) {
      for (const token of [null, TOKEN.slice(0, -1)]) {
        const r = await fm.request(method, path, method === 'POST' ? body : undefined, token);
        expect(r.status, `${method} ${path} ${token}`).toBe(401);
        expect(r.headers.get('www-authenticate')).toBe('Bearer');
        expect(String(r.json?.error)).toContain('password');
      }
    }
    const otherWays: Array<Record<string, string>> = [{ authorization: TOKEN }, { authorization: `Basic ${TOKEN}` }, { 'x-token': TOKEN }, { cookie: `token=${TOKEN}` }];
    for (const headers of otherWays) {
      expect((await fm.request('GET', '/v1/status', undefined, null, headers)).status).toBe(401);
    }
    expect((await fm.request('GET', `/v1/status?token=${TOKEN}`, undefined, null)).status).toBe(401);
    expect(fm.runs()).toEqual([]);
  });

  it('slows a wrong password down, one guess at a time, and keeps it out of the log', async () => {
    const fm = await Fm.start();
    let t = Date.now();
    await fm.request('GET', '/v1/status', undefined, WRONG);
    expect(Date.now() - t).toBeGreaterThanOrEqual(150);
    t = Date.now();
    const finished: Record<string, number> = {};
    const guesses = Array.from({ length: 6 }, (_, i) =>
      fm.request('GET', '/v1/status', undefined, WRONG).then((a) => {
        finished[`wrong${i}`] = Date.now();
        return a;
      }),
    );
    await sleep(300);
    expect((await fm.status()).state).toBe('idle'); // the right password goes straight through, past the queue of wrong ones
    finished.right = Date.now();
    const answers = await Promise.all(guesses);
    expect(answers.map((a) => a.status)).toEqual(Array<number>(6).fill(401));
    const lastWrong = Math.max(...Object.entries(finished).filter(([k]) => k.startsWith('wrong')).map(([, v]) => v));
    expect(finished.right).toBeLessThan(lastWrong - 500);
    expect(lastWrong - t).toBeGreaterThanOrEqual(6 * 200 * 0.8); // one guess at a time
    expect(fm.stderr).toContain('wrong or missing password'); // reported, without the password (checked again when the helper is closed)
  });

  it('does not count a wrong password as hearing from the head unit', async () => {
    const fm = await Fm.start({ config: 'DEADMAN_S=2' });
    expect((await fm.start()).status).toBe(200);
    const end = Date.now() + 3_500;
    while (Date.now() < end) await fm.request('GET', '/v1/status', undefined, WRONG);
    expect((await fm.status()).state).toBe('idle');
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: boards', () => {
  it('never starts the program on a Pi 5, however it is asked', async () => {
    const fm = await Fm.start({ model: PI5, ranges: PI5_RANGES });
    const status = await fm.status();
    expect(status).toMatchObject({ supported: false, board: 'Raspberry Pi 5 Model B Rev 1.0', state: 'idle' });
    expect(String(status.reason)).toContain('Pi 5');
    expect(parseFmNodeStatus(status)).toMatchObject({ supported: false });
    for (const body of [{ frequency: 100.6, bandwidth: 100 }, { frequency: 100.6 }, { frequency: 87.5, bandwidth: 25 }]) {
      const r = await fm.request('POST', '/v1/start', body);
      expect(r.status).toBe(403);
      expect(String(r.json?.error)).toContain('Pi 5');
    }
    await sleep(500);
    expect(fm.runs()).toEqual([]);
    expect((await fm.status()).state).toBe('idle');
    const audio = await fm.audioClient();
    expect(audio.reply.startsWith('ERR ')).toBe(true);
  });

  it('never starts the program on a board it does not recognise, cannot read, or whose address does not match its name', async () => {
    const cases: Array<[Buffer | null, Buffer | null]> = [
      [null, null],
      [Buffer.from('Orange Pi 5\0'), PI4_RANGES],
      [PI4, null],
      [PI4, PI3_RANGES],
      [PI3, PI4_RANGES],
      [Buffer.from('Raspberry Pi 4 Model B Rev 1.4; touch /tmp/x\0'), PI4_RANGES],
      [Buffer.from('Raspberry Pi 500 Rev 1.0\0'), PI4_RANGES],
      [Buffer.from('Raspberry Pi Compute Module 5 Rev 1.0\0'), PI4_RANGES],
    ];
    for (const [model, ranges] of cases) {
      const fm = await Fm.start({ model, ranges });
      expect((await fm.status()).supported).toBe(false);
      const r = await fm.start();
      expect(r.status, String(model)).toBe(403);
      expect(String(r.json?.error).length).toBeGreaterThan(10);
      await sleep(200);
      expect(fm.runs(), String(model)).toEqual([]);
      await fm.close();
      opened.splice(opened.indexOf(fm), 1);
    }
  });

  it('looks at the board again at every start', async () => {
    const fm = await Fm.start();
    expect((await fm.status()).supported).toBe(true);
    writeFileSync(fm.model, PI5);
    expect((await fm.start()).status).toBe(403);
    expect(fm.runs()).toEqual([]);
    expect((await fm.status()).supported).toBe(false);
  });

  it('does start it on a Pi Zero, 3 and 4', async () => {
    for (const [model, ranges] of [[PI4, PI4_RANGES], [PI3, PI3_RANGES], [PI_ZERO, PI_ZERO_RANGES]] as const) {
      const fm = await Fm.start({ model, ranges });
      expect((await fm.start()).status).toBe(200);
      expect((await fm.firstRun()).argv).toEqual(['-f', '100.60', '-b', '100', '-d', '0', '-']);
      await fm.close();
      opened.splice(opened.indexOf(fm), 1);
    }
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: validation', () => {
  it('refuses bad values with a sentence and never starts the program', async () => {
    const fm = await Fm.start();
    const bad: unknown[] = [
      { frequency: 5 }, { frequency: 200 }, { frequency: '100.6' }, { frequency: null }, {}, { frequency: 100.6, bandwidth: 0 },
      { frequency: 100.6, bandwidth: 151 }, { frequency: 100.6, bandwidth: 24 }, { frequency: 100.6, bandwidth: 'x' }, [], 'x', 5, null,
      { frequency: 87.49 }, { frequency: 108.01 }, { frequency: true }, { frequency: 100.6, bandwidth: true }, { frequency: -100.6 },
      { frequency: 100.6, bandwidth: 300 }, { frequency: 1e9 },
    ];
    for (const body of bad) {
      const r = await fm.request('POST', '/v1/start', JSON.stringify(body));
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(String(r.json?.error)).toMatch(/\.$/);
    }
    for (const raw of ['', '{', '{"frequency": NaN}', '{"frequency": Infinity, "bandwidth": 100}', '{"frequency": 1e999}', '{"frequency":100.6,"bandwidth":1e999}', '[['.repeat(500), '\u0000']) {
      expect((await fm.request('POST', '/v1/start', raw)).status, raw.slice(0, 20)).toBe(400);
    }
    expect(fm.runs()).toEqual([]);
    expect((await fm.status()).state).toBe('idle');
  });

  it('accepts the whole band, ends included, and rounds to 0.05 MHz', async () => {
    const fm = await Fm.start();
    for (const [asked, got] of [[87.5, 87.5], [108, 108], [100.63, 100.65], [100.62, 100.6]] as const) {
      const r = await fm.start(asked, 100);
      expect(r.status, String(asked)).toBe(200);
      expect(r.json?.frequency).toBe(got);
    }
    expect((await fm.start(100.6, 25)).status).toBe(200);
    expect((await fm.start(100.6, 150)).status).toBe(200);
  });

  it('narrows to the configured band, and never outside 76 to 108 whatever the config says', async () => {
    const narrow = await Fm.start({ config: 'FREQ_MIN=88\nFREQ_MAX=92\nBANDWIDTH_MAX=80' });
    expect(await narrow.status()).toMatchObject({ limits: { min: 88, max: 92, maxBandwidth: 80 } });
    expect((await narrow.start(87.95, 50)).status).toBe(400);
    expect((await narrow.start(92.05, 50)).status).toBe(400);
    expect((await narrow.start(90, 81)).status).toBe(400);
    expect((await narrow.start(90, 80)).status).toBe(200);
    const wide = await Fm.start({ config: 'FREQ_MIN=10\nFREQ_MAX=500\nBANDWIDTH_MAX=9999' });
    expect(await wide.status()).toMatchObject({ limits: { min: 76, max: 108, maxBandwidth: 150 } });
    expect((await wide.start(75.95, 50)).status).toBe(400);
    expect((await wide.start(108.05, 50)).status).toBe(400);
    expect((await wide.start(300, 50)).status).toBe(400);
    expect((await wide.start(90, 151)).status).toBe(400);
  });

  it('does not let a shell see the values', async () => {
    const fm = await Fm.start();
    for (const value of ['100.6; touch /tmp/fm-pwned-by-vitest', '$(touch /tmp/fm-pwned-by-vitest)', '`id`', '100.6 -r']) {
      expect((await fm.start(value, 100)).status).toBe(400);
      expect((await fm.start(100.6, value)).status).toBe(400);
    }
    expect(fm.runs()).toEqual([]);
    expect(existsSync('/tmp/fm-pwned-by-vitest')).toBe(false);
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: what the transmitter program is given', () => {
  it('gets exactly this argument list, an empty environment, and / as its folder', async () => {
    const fm = await Fm.start({ config: 'DMA=7' });
    expect((await fm.start(100.6, 100)).status).toBe(200);
    const run = await fm.firstRun();
    expect(run.argv).toEqual(['-f', '100.60', '-b', '100', '-d', '7', '-']);
    expect(JSON.parse(run.text('env.json'))).toEqual([]);
    expect(run.text('cwd')).toBe('/');
  });

  it('reads the exact 44 byte header, then silence, in real time, and is never left waiting', async () => {
    const fm = await Fm.start();
    const startedAt = Date.now();
    expect((await fm.start()).status).toBe(200);
    const run = await fm.firstRun();
    await sleep(2_500);
    const data = run.stdin;
    expect(data.subarray(0, 44).equals(EXPECTED_HEADER)).toBe(true);
    const body = data.subarray(44);
    expect(body.equals(Buffer.alloc(body.length))).toBe(true); // nobody is connected: silence only
    expect(run.has('starved')).toBe(false); // the real program takes one silent second for the end of the stream
    expect(run.has('eof')).toBe(false);
    const seconds = (Date.now() - startedAt) / 1000;
    expect(body.length % 2).toBe(0);
    expect(body.length).toBeGreaterThan(44100 * (seconds - 1.8)); // not starved
    expect(body.length).toBeLessThan(44100 * (seconds + 0.6)); // not racing ahead of real time
  });

  it('puts the client\'s sound through whole, in order and sample-aligned', async () => {
    const fm = await Fm.start();
    expect((await fm.start()).status).toBe(200);
    const run = await fm.firstRun();
    const { socket, reply } = await fm.audioClient();
    expect(reply).toBe('OK\n');
    const ramp = Buffer.alloc(14 * 441 * 2); // 14 blocks of 20 ms, every sample different
    for (let i = 0; i < ramp.length / 2; i++) ramp.writeInt16LE(1000 + i, i * 2);
    socket.write(ramp.subarray(0, 1)); // a sample split across sends
    await sleep(60);
    socket.write(ramp.subarray(1, 4001));
    await sleep(60);
    socket.write(ramp.subarray(4001));
    const seen = await until(() => run.stdin.includes(ramp), 8_000);
    expect(seen, `the sound did not arrive intact (${run.stdin.length} bytes)`).toBeTruthy();
    const data = run.stdin;
    expect(data.subarray(0, 44).equals(EXPECTED_HEADER)).toBe(true);
    expect((data.indexOf(ramp) - 44) % 2).toBe(0);
    expect((await fm.status()).audio).toMatchObject({ connected: true });
    socket.destroy();
    expect(await until(async () => !((await fm.status()).audio as Json).connected, 5_000)).toBe(true);
  });

  it('never forwards the client\'s bytes as they are: a header of its own is just sound after ours', async () => {
    const fm = await Fm.start();
    expect((await fm.start()).status).toBe(200);
    const run = await fm.firstRun();
    const { socket } = await fm.audioClient();
    const junk = Buffer.from('RIFF\xff\xff\xff\xffWAVEfmt '.repeat(441), 'latin1'); // 8 whole blocks of bytes that look like a WAV header, over and over
    socket.write(junk);
    expect(await until(() => run.stdin.subarray(44).includes(junk), 8_000)).toBeTruthy();
    const data = run.stdin;
    expect(data.subarray(0, 44).equals(EXPECTED_HEADER)).toBe(true); // the stream starts with our header and only ours
    expect(data.indexOf(junk, 44)).toBeGreaterThanOrEqual(44);
    expect((data.indexOf(junk, 44) - 44) % 2).toBe(0);
    socket.destroy();
  });

  it('holds a flood from the client to real time, and the program keeps being fed', async () => {
    const fm = await Fm.start();
    expect((await fm.start()).status).toBe(200);
    const run = await fm.firstRun();
    const { socket } = await fm.audioClient();
    const blob = tone(1);
    const startedAt = Date.now();
    let total = 0;
    while (Date.now() - startedAt < 1_500) {
      socket.write(blob); // far faster than real time: about 44 KB every 10 ms
      total += blob.length;
      await sleep(10);
    }
    await sleep(300);
    expect(run.has('starved')).toBe(false);
    const sent = run.stdin.length - 44;
    expect(sent % 2).toBe(0);
    expect(sent).toBeLessThan(44100 * ((Date.now() - startedAt) / 1000 + 1));
    expect(total).toBeGreaterThan(sent); // it really was faster than real time
    expect(fm.child.exitCode).toBeNull();
  });

  it('shows the level of the sound and counts the times it ran dry', async () => {
    const fm = await Fm.start();
    expect((await fm.start()).status).toBe(200);
    await fm.firstRun();
    const { socket } = await fm.audioClient();
    const pcm = tone(2, 0.5);
    let level = 0;
    for (let i = 0; i < pcm.length; i += 4410) {
      socket.write(pcm.subarray(i, i + 4410));
      await sleep(100);
      level = Math.max(level, ((await fm.status()).audio as { level: number }).level);
    }
    expect(level).toBeGreaterThan(0.2);
    expect(level).toBeLessThanOrEqual(1);
    socket.destroy();
    await sleep(900);
    expect(((await fm.status()).audio as { level: number }).level).toBeLessThan(0.05);
    const second = await fm.audioClient();
    second.socket.write(tone(0.3));
    await sleep(1_000);
    expect(((await fm.status()).audio as { underruns: number }).underruns).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: audio port', () => {
  it('answers OK or ERR with a reason, and never lets a wrong password in', async () => {
    const fm = await Fm.start();
    expect((await fm.audioClient()).reply).toBe('OK\n');
    const cases: Array<[string, string]> = [
      [`AUDIO 1 ${WRONG}\n`, 'ERR wrong password\n'],
      [`AUDIO 2 ${TOKEN}\n`, 'ERR unsupported protocol version\n'],
      [`AUDIO ${TOKEN}\n`, 'ERR expected: AUDIO 1 <password>\n'],
      [`AUDIO 1 ${TOKEN} extra\n`, 'ERR expected: AUDIO 1 <password>\n'],
      [`audio 1 ${TOKEN}\n`, 'ERR expected: AUDIO 1 <password>\n'],
      ['AUDIO 1 \n', 'ERR wrong password\n'],
    ];
    for (const [hello, expected] of cases) {
      const r = await fm.audioClient(TOKEN, hello);
      expect(r.reply, hello.replace(TOKEN, '<token>')).toBe(expected);
      r.socket.destroy();
    }
    const oversize = await fm.audioClient(TOKEN, 'AUDIO 1 ' + 'a'.repeat(5_000));
    expect(oversize.reply.startsWith('ERR ')).toBe(true);
  });

  it('replaces the old client with a new valid one, and ignores a wrong one', async () => {
    const fm = await Fm.start();
    const first = await fm.audioClient();
    const closed = new Promise<void>((resolve) => first.socket.once('close', () => resolve()));
    const second = await fm.audioClient();
    expect(second.reply).toBe('OK\n');
    await Promise.race([closed, sleep(5_000).then(() => Promise.reject(new Error('the first client was not closed')))]);
    expect(((await fm.status()).audio as Json).connected).toBe(true);
    const wrong = await fm.audioClient(WRONG);
    expect(wrong.reply).toBe('ERR wrong password\n');
    await sleep(200);
    expect(((await fm.status()).audio as Json).connected).toBe(true);
  });

  it('gives up on a client that says nothing within three seconds', async () => {
    const fm = await Fm.start();
    const r = await rawExchange(fm.audio, '', 8_000);
    expect(r.data.toString('latin1').startsWith('ERR ')).toBe(true);
    expect(r.took).toBeGreaterThan(2_400);
    expect(r.took).toBeLessThan(6_000);
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: dead-man, retune, stop, errors', () => {
  it('switches the transmitter off when the head unit goes quiet, and keeps it on while it is heard', async () => {
    const fm = await Fm.start({ config: 'DEADMAN_S=2' });
    expect((await fm.start()).status).toBe(200);
    const run = await fm.firstRun();
    const end = Date.now() + 3_500;
    while (Date.now() < end) {
      expect((await fm.status()).state).toBe('transmitting'); // asking is hearing
      await sleep(250);
    }
    await sleep(100);
    const pid = run.pid;
    expect(await until(() => !alive(pid), 9_000, 100), 'the program is still running').toBe(true);
    expect(run.has('term')).toBe(true);
    const status = await fm.status();
    expect(status).toMatchObject({ state: 'idle', frequency: null, error: null, deadmanS: 2 });
    expect(fm.stderr).toContain('dead-man');
    expect(fm.runs()).toHaveLength(1); // not started again by itself
  });

  it('counts sound from the head unit as hearing from it', async () => {
    const fm = await Fm.start({ config: 'DEADMAN_S=2' });
    expect((await fm.start()).status).toBe(200);
    const { socket } = await fm.audioClient();
    const end = Date.now() + 3_500;
    while (Date.now() < end) {
      socket.write(Buffer.alloc(882));
      await sleep(20);
    }
    expect((await fm.status()).state).toBe('transmitting');
  });

  it('retunes with a fresh header and the old program gone, and does nothing for an unchanged start', async () => {
    const fm = await Fm.start();
    await fm.start(100.6, 100);
    const first = await fm.firstRun();
    expect((await fm.start(100.62, 100)).status).toBe(200); // the same 100.60 after rounding
    expect(fm.runs()).toHaveLength(1);
    const r = await fm.start(101.1, 100);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: 'transmitting', frequency: 101.1 });
    expect(alive(first.pid)).toBe(false);
    expect(first.has('term')).toBe(true);
    const runs = fm.runs();
    expect(runs).toHaveLength(2);
    expect(runs[1]?.argv.slice(0, 2)).toEqual(['-f', '101.10']);
    expect(await until(() => runs[1]?.stdin.subarray(0, 44).equals(EXPECTED_HEADER), 5_000)).toBe(true);
  });

  it('stop switches the carrier off and has reaped the program when it answers, twice over', async () => {
    const fm = await Fm.start();
    await fm.start();
    const run = await fm.firstRun();
    expect(alive(run.pid)).toBe(true);
    const r = await fm.request('POST', '/v1/stop');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: 'idle', frequency: null, bandwidth: null });
    expect(alive(run.pid)).toBe(false);
    expect(run.has('term')).toBe(true); // asked to stop with SIGTERM, so that it can release the GPIO
    expect(await fm.request('POST', '/v1/stop')).toMatchObject({ status: 200 });
    expect(fm.runs()).toHaveLength(1);
  });

  it('kills a program that ignores SIGTERM after two seconds', async () => {
    const fm = await Fm.start({ mode: 'ignore_term' });
    await fm.start();
    const run = await fm.firstRun();
    const t = Date.now();
    const r = await fm.request('POST', '/v1/stop');
    const took = Date.now() - t;
    expect(r.json).toMatchObject({ state: 'idle' });
    expect(took).toBeGreaterThanOrEqual(1_800);
    expect(took).toBeLessThan(8_000);
    expect(alive(run.pid)).toBe(false);
    expect(fm.stderr).toContain('killed');
  });

  it('stops the program before it exits when the helper itself is asked to stop', async () => {
    const fm = await Fm.start();
    await fm.start();
    const run = await fm.firstRun();
    const exited = new Promise<number | null>((resolve) => fm.child.once('exit', (code) => resolve(code)));
    fm.child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(alive(run.pid)).toBe(false);
    expect(run.has('term')).toBe(true);
  });

  it('says why when the program fails at once, waits five seconds before another try, and does not restart by itself', async () => {
    const fm = await Fm.start({ mode: 'fail:Error: Cannot open /dev/mem file (permission denied)' });
    const r = await fm.start();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ state: 'error', error: 'Error: Cannot open /dev/mem file (permission denied)', frequency: null });
    expect(parseFmNodeStatus(r.json)).toMatchObject({ state: 'error' });
    const again = await fm.start();
    expect(again.status).toBe(409);
    expect(String(again.json?.error)).toContain('Wait');
    await sleep(1_500);
    expect(fm.runs()).toHaveLength(1);
    fm.setMode('');
    const startedAt = Date.now();
    let reply = again;
    while (reply.status === 409 && Date.now() - startedAt < 9_000) {
      await sleep(250);
      reply = await fm.start();
    }
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ state: 'transmitting' });
    expect(Date.now() - startedAt + 1_500).toBeGreaterThan(4_000);
    expect(fm.runs()).toHaveLength(2);
  });

  it('reports a program that dies later, and one that ends by itself with code 0', async () => {
    const fm = await Fm.start();
    await fm.start();
    const run = await fm.firstRun();
    process.kill(run.pid, 'SIGKILL');
    const status = await until(async () => {
      const s = await fm.status();
      return s.state === 'error' ? s : undefined;
    }, 6_000);
    expect(status?.error).toBe('The transmitter program was stopped by signal 9.');
    await sleep(800);
    expect(fm.runs()).toHaveLength(1);

    const quits = await Fm.start({ mode: 'exit0' });
    const r = await quits.start();
    expect(r.json).toMatchObject({ state: 'error', error: 'The transmitter program stopped by itself (exit code 0).' });
  });

  it('answers a missing or changeable program with a plain error and does not run it', async () => {
    const missing = await Fm.start();
    rmSync(missing.binary);
    const r = await missing.start();
    expect(r.json).toMatchObject({ state: 'error' });
    expect(String(r.json?.error)).toContain('missing');
    expect(String(r.json?.error)).toContain('setup-fm.sh');

    const loose = await Fm.start({ binaryMode: 0o777 });
    const l = await loose.start();
    expect(l.json?.state).toBe('error');
    expect(String(l.json?.error)).toContain('can be changed by other users');
    expect(loose.runs()).toEqual([]);
  });

  it('restarts the program with a fresh header before the stream limit', async () => {
    const fm = await Fm.start({ args: ['--rollover-bytes', '100000'] });
    await fm.start();
    const runs = await until(() => (fm.runs().length >= 2 ? fm.runs() : undefined), 14_000);
    expect(runs, fm.stderr).toBeTruthy();
    const [one, two] = runs ?? [];
    expect(one?.has('term')).toBe(true);
    expect(await until(() => two?.stdin.subarray(0, 44).equals(EXPECTED_HEADER), 5_000)).toBe(true);
    expect(two?.argv).toEqual(one?.argv);
    expect((one?.stdin.length ?? 0)).toBeLessThan(100_000 + 45_000); // it was not left running to the 4 GB end
    expect((await fm.status()).state).toBe('transmitting');
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: startup and limits', () => {
  it('will not start without a long enough password or without a config file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-helper-cfg-'));
    try {
      const cfg = join(dir, 'c.conf');
      for (const text of ['', 'TOKEN=short\n', 'BIND=127.0.0.1\n', `TOKEN=${'a'.repeat(20)}\nBIND=nope\n`]) {
        writeFileSync(cfg, text, { mode: 0o600 });
        const done = await runPython(['-B', HELPER, '--config', cfg, '--control-port', '0', '--audio-port', '0']);
        expect(done.code, JSON.stringify(text)).toBe(2);
        expect(done.stdout).toBe('');
        expect(done.stderr).not.toContain('Traceback');
      }
      const none = await runPython(['-B', HELPER, '--config', join(dir, 'missing.conf')]);
      expect(none.code).toBe(2);
      expect(none.stderr).toContain('cannot be read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints where it listens as one JSON line, and --check-board says yes or no with a reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-helper-board-'));
    try {
      const model = join(dir, 'model');
      const ranges = join(dir, 'ranges');
      writeFileSync(model, PI4);
      writeFileSync(ranges, PI4_RANGES);
      const yes = await runPython(['-B', HELPER, '--check-board', '--model-file', model, '--ranges-file', ranges]);
      expect(yes.code).toBe(0);
      expect(JSON.parse(yes.stdout)).toEqual({ supported: true, board: 'Raspberry Pi 4 Model B Rev 1.4', reason: null });
      writeFileSync(model, PI5);
      writeFileSync(ranges, PI5_RANGES);
      const no = await runPython(['-B', HELPER, '--check-board', '--model-file', model, '--ranges-file', ranges]);
      expect(no.code).toBe(1);
      expect(JSON.parse(no.stdout)).toMatchObject({ supported: false, board: 'Raspberry Pi 5 Model B Rev 1.0' });
      const missing = await runPython(['-B', HELPER, '--check-board', '--model-file', join(dir, 'nope'), '--ranges-file', join(dir, 'nope')]);
      expect(missing.code).toBe(1);
      expect(JSON.parse(missing.stdout)).toMatchObject({ supported: false, board: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses oversized bodies, lines and header blocks, and bad requests, without crashing', async () => {
    const fm = await Fm.start();
    const head = (length: number) =>
      `POST /v1/start HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`;
    expect(statusLine((await rawExchange(fm.control, head(1025) + '{'.repeat(1025))).data)).toContain(' 413 ');
    expect(statusLine((await rawExchange(fm.control, head(1e9))).data)).toContain(' 413 ');
    const big = JSON.stringify({ frequency: 100.6, bandwidth: 100, pad: 'x'.repeat(2_000) });
    expect((await fm.request('POST', '/v1/start', big)).status).toBe(413);
    expect(statusLine((await rawExchange(fm.control, `GET /${'a'.repeat(20_000)} HTTP/1.1\r\n\r\n`)).data)).toMatch(/ (400|431) /);
    expect(statusLine((await rawExchange(fm.control, `GET /v1/status HTTP/1.1\r\nX-Pad: ${'a'.repeat(20_000)}\r\n\r\n`)).data)).toContain(' 431 ');
    const many = Array.from({ length: 100 }, (_, i) => `X-${i}: y\r\n`).join('');
    expect(statusLine((await rawExchange(fm.control, `GET /v1/status HTTP/1.1\r\n${many}\r\n`)).data)).toContain(' 431 ');
    for (const junk of [
      '\u0000\u0001\u0002\r\n\r\n',
      'GET\r\n\r\n',
      'GET / HTTP/9\r\n\r\n',
      'get / HTTP/1.1\r\n\r\n',
      'GET /v1/status HTTP/1.1\nHost: x\n\n',
      'POST /v1/start HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n',
      'POST /v1/start HTTP/1.1\r\nContent-Length: abc\r\n\r\n',
      'POST /v1/start HTTP/1.1\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\n',
    ]) {
      const r = await rawExchange(fm.control, junk);
      expect(statusLine(r.data), JSON.stringify(junk)).toMatch(/^HTTP\/1\.1 4\d\d /);
      expect(r.data.toString('latin1')).not.toContain('Traceback');
    }
    expect(fm.runs()).toEqual([]);
    expect((await fm.status()).state).toBe('idle');
  });

  it('cuts off a request that stalls half way after about five seconds', async () => {
    const fm = await Fm.start();
    const r = await rawExchange(fm.control, `POST /v1/start HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Length: 50\r\n\r\n{`, 15_000);
    expect(statusLine(r.data)).toContain(' 408 ');
    expect(r.took).toBeGreaterThan(4_000);
    expect(r.took).toBeLessThan(9_000);
  });

  it('turns away connections beyond a handful from one address, keeps few threads, and answers again afterwards', async () => {
    const fm = await Fm.start();
    const sockets: net.Socket[] = [];
    let turnedAway = 0;
    try {
      for (let i = 0; i < 60; i++) {
        const sock = net.connect(fm.control, '127.0.0.1');
        sock.on('error', () => undefined);
        sock.on('close', () => {
          turnedAway += 1;
        });
        sock.resume(); // read (and ignore) what comes, or the hang-up is never noticed
        sockets.push(sock);
        await new Promise<void>((resolve) => sock.once('connect', () => resolve())); // one at a time, so none is lost to a full listen queue
      }
      await sleep(1_500); // well inside the five seconds after which an idle connection would be cut off anyway
      expect(turnedAway).toBeGreaterThanOrEqual(60 - 8 - 1); // at most 8 held at once from one address
      const threads = Number(/Threads:\s+(\d+)/.exec(readFileSync(`/proc/${fm.child.pid}/status`, 'utf8'))?.[1] ?? 0);
      expect(threads).toBeLessThan(40);
    } finally {
      for (const s of sockets) s.destroy();
    }
    expect(await until(async () => (await fm.request('GET', '/v1/status')).status === 200, 8_000)).toBe(true);
  });

  it('keeps answering a good client while garbage arrives, and survives clients that never read', async () => {
    const fm = await Fm.start();
    let stop = false;
    const noise = (async () => {
      while (!stop) {
        await rawExchange(fm.control, Buffer.alloc(50), 200).catch(() => undefined);
      }
    })();
    let ok = 0;
    for (let i = 0; i < 8; i++) {
      try {
        if ((await fm.request('GET', '/v1/status')).status === 200) ok += 1;
      } catch {
        // a turned-away connection; the next one will do
      }
      await sleep(100);
    }
    stop = true;
    await noise;
    expect(ok).toBeGreaterThanOrEqual(4);
    expect(fm.child.exitCode).toBeNull();
  });
});

describe.skipIf(!pythonAvailable)('the FM helper: its own python tests', () => {
  it('passes the quick python unit tests (board table, config, validation, header, ring) and the real WaveReader check', async () => {
    const groups = ['BoardCheck', 'CliBoard', 'Config', 'StartBody', 'WavHeader', 'RingTests', 'SourceTests', 'TokenCheck', 'AudioStream', 'NodeGuard', 'RealWaveReader'];
    const args = ['-B', '-m', 'unittest', 'discover', '-s', join(REPO, 'deploy', 'fm-node')];
    for (const g of groups) args.push('-k', g);
    const done = await runPython(args, { FM_NODE_PATH: HELPER, PYTHONDONTWRITEBYTECODE: '1' });
    expect(done.stderr + done.stdout).toMatch(/\bOK\b/);
    expect(done.code, done.stderr.slice(-2_000)).toBe(0);
  });
});

function runPython(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('python3', args, { env: { PATH: process.env.PATH ?? '', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
