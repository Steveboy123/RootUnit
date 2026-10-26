import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FM_NOTICE_VERSION, FM_PROTOCOL } from '@headunit/shared';
import { readFmConfig } from './config';
import { FmService } from './service';
import { MemStore, TOKEN, captureConsole, until, type FakeNodeState } from './testing/fakes';

// Real processes and sockets: allow for a slow Pi.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The real client against a stand-in for the FM helper made from node's own `http` and `net`, with the real `fetch`, the real TCP
 * connection and a real (stand-in) parec process. Nothing here is faked inside the server: what the helper receives is what would
 * go over the wire to a real one.
 */

interface SeenRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

interface AudioSession {
  firstLine: string;
  pcm: Buffer;
  closed: boolean;
  socket: Socket;
}

class StandInHelper {
  requests: SeenRequest[] = [];
  sessions: AudioSession[] = [];
  controlToken = TOKEN;
  audioToken = TOKEN;
  node: FakeNodeState = {
    protocol: FM_PROTOCOL,
    version: '1.0.0',
    board: 'Raspberry Pi 4 Model B Rev 1.4',
    supported: true,
    reason: null,
    state: 'idle',
    frequency: null,
    bandwidth: null,
    audio: { connected: false, level: 0.25, underruns: 0 },
    error: null,
    limits: { min: 87.5, max: 108, maxBandwidth: 150 },
    deadmanS: 30,
  };
  http!: HttpServer;
  private tcp!: TcpServer;
  controlPort = 0;
  audioPort = 0;

  async listen(): Promise<void> {
    this.http = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        const send = (status: number, value: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(value));
        };
        if (req.headers.authorization !== `Bearer ${this.controlToken}`) return send(401, { error: 'Wrong password.' });
        if (req.method === 'GET' && req.url === '/v1/status') return send(200, this.node);
        if (req.method === 'POST' && req.url === '/v1/start') {
          const b = JSON.parse(body) as { frequency: number; bandwidth: number };
          this.node.state = 'transmitting';
          this.node.frequency = b.frequency;
          this.node.bandwidth = b.bandwidth;
          return send(200, this.node);
        }
        if (req.method === 'POST' && req.url === '/v1/stop') {
          this.node.state = 'idle';
          this.node.frequency = null;
          return send(200, this.node);
        }
        return send(404, { error: 'Not found.' });
      });
    });
    await new Promise<void>((r) => this.http.listen(0, '127.0.0.1', r));
    this.controlPort = (this.http.address() as AddressInfo).port;

    this.tcp = createTcpServer((socket) => {
      const session: AudioSession = { firstLine: '', pcm: Buffer.alloc(0), closed: false, socket };
      this.sessions.push(session);
      let head = Buffer.alloc(0);
      let accepted = false;
      socket.on('data', (d: Buffer) => {
        if (accepted) {
          session.pcm = Buffer.concat([session.pcm, d]);
          return;
        }
        head = Buffer.concat([head, d]);
        const nl = head.indexOf(0x0a);
        if (nl < 0) return;
        session.firstLine = head.subarray(0, nl).toString('latin1');
        if (session.firstLine === `AUDIO 1 ${this.audioToken}`) {
          accepted = true;
          this.node.audio.connected = true;
          socket.write('OK\n');
          session.pcm = Buffer.from(head.subarray(nl + 1));
        } else {
          socket.end('ERR bad password\n');
        }
      });
      socket.on('close', () => {
        session.closed = true;
        if (accepted) this.node.audio.connected = false;
      });
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => this.tcp.listen(0, '127.0.0.1', r));
    this.audioPort = (this.tcp.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    for (const s of this.sessions) s.socket.destroy();
    this.http.closeAllConnections();
    await Promise.all([new Promise((r) => this.http.close(r)), new Promise((r) => this.tcp.close(r))]);
  }

  to(method: string, url: string): SeenRequest[] {
    return this.requests.filter((r) => r.method === method && r.url === url);
  }
}

const PCM = Buffer.from(Array.from({ length: 20_000 }, (_, i) => (i * 7 + (i >> 8)) & 0xff));
const ARGS = ['--device=@DEFAULT_MONITOR@', '--raw', '--rate=22050', '--channels=1', '--format=s16le', '--latency-msec=50'];

let dir: string;
let helper: StandInHelper;
let service: FmService | null = null;
let quiet: ReturnType<typeof captureConsole>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fm-wire-'));
  helper = new StandInHelper();
  await helper.listen();
  quiet = captureConsole();
  // If the server passed its environment on as it is, the stand-in parec would see the password.
  vi.stubEnv('FM_NODE_TOKEN', TOKEN);
});
afterEach(async () => {
  await service?.stop();
  service = null;
  await helper.close();
  vi.unstubAllEnvs();
  quiet.restore();
  await rm(dir, { recursive: true, force: true });
});

/**
 * A program that behaves like parec for the parts that matter: records how it was started, prints sound (after a second: sound printed
 * before the helper has said OK is thrown away on purpose), and runs until it is ended.
 */
async function fakeParec(): Promise<string> {
  await writeFile(join(dir, 'pcm.bin'), PCM);
  const script = join(dir, 'parec');
  await writeFile(
    script,
    `#!/bin/sh
printf '%s\\n' "$@" > '${dir}/args.txt'
env | grep -c '^FM_NODE_TOKEN=' > '${dir}/token-in-env.txt'
echo $$ > '${dir}/pid.txt'
sleep 1
cat '${dir}/pcm.bin'
exec sleep 60
`,
  );
  await chmod(script, 0o755);
  return script;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function make(over: { parecCommand?: string; file?: unknown } = {}): { service: FmService; store: MemStore } {
  const store = new MemStore();
  store.files.set('fm.json', over.file ?? { version: 1, frequency: 100.6, on: false, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } });
  const config = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: `http://127.0.0.1:${helper.controlPort}`, FM_NODE_AUDIO_PORT: String(helper.audioPort) });
  service = new FmService({ store: store.asStore(), config, ...(over.parecCommand ? { parecCommand: over.parecCommand } : {}) });
  return { service, store };
}

describe('over real sockets', () => {
  it('the control requests, the first line of the sound and the sound itself are exactly what the protocol says', async () => {
    const { service: fm } = make({ parecCommand: await fakeParec() });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(fm.state.get().status).toBe('transmitting'), 8000);

    // ---- control: HTTP -------------------------------------------------------------------------------------------------------
    const status = helper.to('GET', '/v1/status')[0]!;
    expect(status.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(status.headers.connection).toBe('close');
    expect(status.headers.accept).toBe('application/json');
    expect(status.headers.host).toBe(`127.0.0.1:${helper.controlPort}`);
    expect(status.body).toBe('');

    const start = helper.to('POST', '/v1/start');
    expect(start).toHaveLength(1);
    expect(start[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(start[0]!.headers['content-type']).toBe('application/json');
    expect(start[0]!.headers.connection).toBe('close');
    expect(start[0]!.body).toBe('{"frequency":100.6,"bandwidth":100}');
    // the password is in the header, never in the address or the body
    for (const r of helper.requests) {
      expect(r.url).not.toContain(TOKEN);
      expect(r.body).not.toContain(TOKEN);
    }

    // ---- sound: TCP ----------------------------------------------------------------------------------------------------------
    await until(() => expect(helper.sessions[0]?.pcm.length).toBe(PCM.length), 5000);
    expect(helper.sessions).toHaveLength(1);
    expect(helper.sessions[0]!.firstLine).toBe(`AUDIO 1 ${TOKEN}`);
    expect(helper.sessions[0]!.firstLine.length + 1).toBeLessThanOrEqual(128);
    // every byte parec printed, in order, and nothing else (no second copy of the line, no framing)
    expect(helper.sessions[0]!.pcm.equals(PCM)).toBe(true);

    // ---- parec: how it was started ---------------------------------------------------------------------------------------------
    expect((await readFile(join(dir, 'args.txt'), 'utf8')).trim().split('\n')).toEqual(ARGS);
    expect((await readFile(join(dir, 'token-in-env.txt'), 'utf8')).trim()).toBe('0');
    const pid = Number((await readFile(join(dir, 'pid.txt'), 'utf8')).trim());
    expect(alive(pid)).toBe(true);

    // ---- retune: a second start, the same sound connection -------------------------------------------------------------------------
    await fm.tune(95.5);
    await until(() => expect(helper.to('POST', '/v1/start')).toHaveLength(2));
    expect(helper.to('POST', '/v1/start')[1]!.body).toBe('{"frequency":95.5,"bandwidth":100}');
    expect(helper.sessions).toHaveLength(1);
    expect(helper.sessions[0]!.closed).toBe(false);
    expect(alive(pid)).toBe(true);

    // ---- off: stop, the sound connection closed, parec gone ----------------------------------------------------------------------------
    await fm.setOn(false);
    await until(() => expect(helper.to('POST', '/v1/stop')).toHaveLength(1));
    await until(() => expect(helper.sessions[0]!.closed).toBe(true));
    await until(() => expect(alive(pid)).toBe(false), 5000);
    expect(fm.state.get().status).toBe('idle');
    expect(helper.to('POST', '/v1/stop')[0]!.body).toBe('{}');

    // nothing in the log or the state holds the password
    expect(quiet.lines.join('\n')).not.toContain(TOKEN);
    expect(JSON.stringify(fm.state.get())).not.toContain(TOKEN);
  });

  it('stopping the server while it is on the air switches the helper off and ends parec', async () => {
    const { service: fm } = make({ parecCommand: await fakeParec() });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(fm.state.get().status).toBe('transmitting'), 8000);
    // (the stand-in writes its process number a moment after it starts: wait for it)
    await until(() => expect(readFileSync(join(dir, 'pid.txt'), 'utf8').trim()).toMatch(/^\d+$/));
    const pid = Number((await readFile(join(dir, 'pid.txt'), 'utf8')).trim());
    await fm.stop();
    expect(helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(helper.node.state).toBe('idle');
    await until(() => expect(helper.sessions[0]!.closed).toBe(true));
    await until(() => expect(alive(pid)).toBe(false), 5000);
    const seen = helper.requests.length;
    await new Promise((r) => setTimeout(r, 2300));
    expect(helper.requests.length).toBe(seen); // not a request more once stopped
  });

  it('a wrong password on the control side: 401, "refused the password", nothing started and no sound opened', async () => {
    helper.controlToken = 'a-different-password-0123456789';
    const { service: fm } = make({ parecCommand: await fakeParec() });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(fm.state.get().status).toBe('error'), 5000);
    expect(fm.state.get().detail).toMatch(/refused the password/);
    expect(helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(helper.sessions).toHaveLength(0);
  });

  it('a helper that refuses the sound: no sound is sent to it', async () => {
    helper.audioToken = 'a-different-password-0123456789';
    const { service: fm } = make({ parecCommand: await fakeParec() });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(helper.sessions.length).toBeGreaterThanOrEqual(1), 5000);
    await until(() => expect(fm.state.get().detail).toMatch(/refused the sound connection: bad password/), 5000);
    for (const s of helper.sessions) expect(s.pcm.length).toBe(0);
    expect(fm.state.get().status).not.toBe('transmitting');
  });

  it('parec missing: the exact words, and the sound port is never even connected to', async () => {
    const { service: fm } = make({ parecCommand: join(dir, 'does-not-exist', 'parec') });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(fm.state.get().status).toBe('error'), 5000);
    expect(fm.state.get().detail).toBe('Sound capture (parec) is missing: sudo apt install pulseaudio-utils');
    expect(helper.sessions).toHaveLength(0);
  });

  it('the helper vanishes: unreachable, then it is found again when it returns', async () => {
    const { service: fm } = make({ parecCommand: await fakeParec() });
    await fm.start();
    await fm.setOn(true);
    await until(() => expect(fm.state.get().status).toBe('transmitting'), 8000);
    helper.http.closeAllConnections();
    const port = helper.controlPort;
    await new Promise((r) => helper.http.close(r));
    await until(() => expect(fm.state.get().status).toBe('unreachable'), 8000);
    expect(fm.state.get().detail).not.toContain(String(port));
    await new Promise<void>((r) => helper.http.listen(port, '127.0.0.1', r));
    await until(() => expect(fm.state.get().status).toBe('transmitting'), 15_000);
  }, 30_000);
});
