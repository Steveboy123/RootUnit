import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapturePump, DEFAULT_MAX_BEHIND_BYTES, parecArgs, type PumpFailure, type PumpOptions } from './capture';
import { FmSecret } from './config';
import { FakeNet, TOKEN, sleepFor } from './testing/fakes';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
});

const flush = () => new Promise<void>((r) => queueMicrotask(r));

function setup(over: Partial<PumpOptions> = {}) {
  const net = new FakeNet();
  const seen = { streaming: 0, down: [] as PumpFailure[] };
  const pump = new CapturePump({
    source: '@DEFAULT_MONITOR@',
    host: '192.168.1.50',
    port: 8789,
    token: new FmSecret(TOKEN),
    spawn: net.spawn,
    connect: net.connect,
    onStreaming: () => void seen.streaming++,
    onDown: (f) => void seen.down.push(f),
    ...over,
  });
  return { net, seen, pump };
}

/** Takes the pump all the way to streaming by hand, the way the real programs would. */
async function bringUp(ctx: ReturnType<typeof setup>) {
  ctx.pump.start();
  await flush();
  ctx.net.child.spawned();
  ctx.net.socket.connected();
  ctx.net.socket.reply('OK\n');
  expect(ctx.pump.phase).toBe('streaming');
}

/** A stream where byte i is i mod 256, so a piece's first value says where in the stream it began. */
const ramp = (from: number, length: number) => Buffer.from(Array.from({ length }, (_, i) => (from + i) & 0xff));

describe('CapturePump: the way up', () => {
  it('runs parec on the monitor of the default output, then connects, says AUDIO 1 and the password, waits for OK', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    expect(c.net.children).toHaveLength(1);
    expect(c.net.child.command).toBe('parec');
    expect(c.net.child.args).toEqual(['--device=@DEFAULT_MONITOR@', '--raw', '--rate=22050', '--channels=1', '--format=s16le', '--latency-msec=50']);
    // nothing on the network before parec is known to run
    expect(c.net.sockets).toHaveLength(0);
    c.net.child.spawned();
    expect(c.net.sockets).toHaveLength(1);
    expect(c.net.socket).toMatchObject({ port: 8789, host: '192.168.1.50' });
    expect(c.net.socket.written).toHaveLength(0); // not before the connection is open
    c.net.socket.connected();
    expect(c.net.socket.written).toHaveLength(1);
    expect(c.net.socket.written[0]!.toString('latin1')).toBe(`AUDIO 1 ${TOKEN}\n`);
    expect(c.net.socket.written[0]!.length).toBeLessThanOrEqual(128);
    expect(c.net.socket.noDelay).toBe(true);
    expect(c.pump.phase).toBe('connecting');
    expect(c.seen.streaming).toBe(0);
    c.net.socket.reply('OK\n');
    expect(c.pump.phase).toBe('streaming');
    expect(c.seen.streaming).toBe(1);
    c.pump.stop();
  });

  it('the password is in the first line only: not in the arguments of parec, and not in anything else that is sent', async () => {
    const c = setup();
    await bringUp(c);
    c.net.child.sound(ramp(0, 2000));
    expect(c.net.child.args.join(' ')).not.toContain(TOKEN);
    expect(c.net.socket.sound.toString('latin1')).not.toContain(TOKEN);
    c.pump.stop();
  });

  it('the source can be named, and the recorder program can be replaced (tests only)', async () => {
    const c = setup({ source: 'alsa_output.usb-DAC.monitor', command: '/tmp/fake-parec' });
    c.pump.start();
    expect(c.net.child.command).toBe('/tmp/fake-parec');
    expect(c.net.child.args[0]).toBe('--device=alsa_output.usb-DAC.monitor');
    expect(parecArgs('x')[0]).toBe('--device=x');
    c.pump.stop();
  });

  it('every byte parec makes arrives, in order, untouched', async () => {
    const c = setup();
    await bringUp(c);
    const parts = [ramp(0, 882), ramp(882, 882), ramp(1764, 1200), ramp(2964, 36)];
    for (const p of parts) c.net.child.sound(p);
    expect(c.net.socket.sound.equals(ramp(0, 3000))).toBe(true);
    expect(c.pump.sentBytes).toBe(3000);
    expect(c.pump.droppedBytes).toBe(0);
    c.pump.stop();
  });

  it('sound that arrives before the helper has said OK is not kept: it is out of date', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.net.child.sound(ramp(0, 4000));
    c.net.socket.reply('OK\n');
    expect(c.net.socket.sound.length).toBe(0);
    c.net.child.sound(ramp(0, 100));
    expect(c.net.socket.sound.length).toBe(100);
    c.pump.stop();
  });

  it('the OK may arrive in pieces, with more after it', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.net.socket.reply('O');
    expect(c.pump.phase).toBe('connecting');
    c.net.socket.reply('K\nextra that is ignored');
    expect(c.pump.phase).toBe('streaming');
    c.net.socket.reply('more noise from the other end');
    expect(c.pump.phase).toBe('streaming');
    c.pump.stop();
  });
});

describe('CapturePump: every way it can fail, said once, and everything closed', () => {
  it('parec is not installed: the password is never sent and nothing is connected', async () => {
    const c = setup();
    c.net.missingParec = true;
    c.pump.start();
    await flush();
    expect(c.seen.down).toEqual([{ kind: 'missing-parec' }]);
    expect(c.net.sockets).toHaveLength(0);
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(c.pump.phase).toBe('down');
  });

  it('spawn itself throwing is handled too', () => {
    const c = setup({
      spawn: () => {
        throw Object.assign(new Error('spawn parec ENOENT'), { code: 'ENOENT' });
      },
    });
    c.pump.start();
    expect(c.seen.down).toEqual([{ kind: 'missing-parec' }]);
    const d = setup({
      spawn: () => {
        throw new Error('EAGAIN');
      },
    });
    d.pump.start();
    expect(d.seen.down).toHaveLength(1);
    expect(d.seen.down[0]).toMatchObject({ kind: 'capture' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('parec stops by itself: the last thing it said is the reason, and the connection is closed', async () => {
    const c = setup();
    await bringUp(c);
    c.net.child.say('Connection failure: Connection refused\npa_context_connect() failed: Connection refused\n');
    c.net.child.exit(1);
    expect(c.seen.down).toEqual([{ kind: 'capture', message: 'parec stopped: pa_context_connect() failed: Connection refused' }]);
    expect(c.net.socket.destroyed).toBe(true);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('parec stops without a word', async () => {
    const c = setup();
    await bringUp(c);
    c.net.child.exit(0);
    expect(c.seen.down).toEqual([{ kind: 'capture', message: 'parec stopped.' }]);
  });

  it('the helper refuses the connection (wrong address, helper not running)', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.failWith('ECONNREFUSED');
    expect(c.seen.down).toEqual([{ kind: 'connect', message: 'connection refused' }]);
    // the error text of the library holds the address and the password; none of it is passed on
    expect(JSON.stringify(c.seen.down)).not.toContain(TOKEN);
    expect(JSON.stringify(c.seen.down)).not.toContain('192.168');
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(c.net.child.signals).toEqual(['SIGTERM']);
  });

  it('the helper says ERR with a reason', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.net.socket.reply('ERR bad password\n');
    expect(c.seen.down).toEqual([{ kind: 'refused', message: 'bad password' }]);
    expect(c.seen.streaming).toBe(0);
    await flush();
    expect(c.net.leftBehind).toBe(0);
  });

  it('something else answers (a web server, a different service)', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.net.socket.reply('HTTP/1.1 400 Bad Request\r\n');
    expect(c.seen.down).toHaveLength(1);
    expect(c.seen.down[0]).toMatchObject({ kind: 'refused', message: expect.stringMatching(/not.*FM helper|did not answer like/) });
    expect(c.seen.streaming).toBe(0);
  });

  it('an answer that never ends its line is not buffered without limit', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.net.socket.reply('x'.repeat(300));
    expect(c.seen.down).toHaveLength(1);
    expect(c.seen.down[0]).toMatchObject({ kind: 'refused' });
  });

  it('no OK within 3 seconds of the first line', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    await sleepFor(2999);
    expect(c.seen.down).toHaveLength(0);
    await sleepFor(2);
    expect(c.seen.down).toEqual([{ kind: 'timeout' }]);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('no connection within 5 seconds of starting', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    await sleepFor(5001);
    expect(c.seen.down).toEqual([{ kind: 'connect', message: 'no answer' }]);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('parec that never starts is given up on too', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    await sleepFor(5001);
    expect(c.seen.down).toHaveLength(1);
    expect(c.net.sockets).toHaveLength(0);
  });

  it('the helper closes the connection while streaming (another head unit took over, or the helper stopped)', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.peerCloses();
    expect(c.seen.down).toEqual([{ kind: 'closed', message: 'The connection was closed.' }]);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(c.net.child.signals).toEqual(['SIGTERM']);
  });

  it('a socket error while streaming', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.failWith('ECONNRESET');
    expect(c.seen.down).toEqual([{ kind: 'closed', message: 'connection dropped' }]);
  });

  it('a read error on the pipes of parec is not an uncaught exception', async () => {
    const c = setup();
    await bringUp(c);
    expect(() => c.net.child.stdout.emit('error', new Error('read EIO'))).not.toThrow();
    expect(() => c.net.child.stderr.emit('error', new Error('read EIO'))).not.toThrow();
    expect(c.pump.phase).toBe('streaming');
    c.net.child.exit(1);
    expect(c.seen.down).toHaveLength(1);
  });

  it('the failure is reported once, however many things go wrong at the same time', async () => {
    const c = setup();
    await bringUp(c);
    c.net.child.exit(1);
    c.net.socket.failWith('ECONNRESET');
    c.net.socket.peerCloses();
    c.net.child.enoent();
    expect(c.seen.down).toHaveLength(1);
  });

  it('connect throwing is a failure, not a crash', async () => {
    const c = setup({
      connect: () => {
        throw new Error(`bad host ${TOKEN}`);
      },
    });
    c.pump.start();
    await flush();
    c.net.child.spawned();
    expect(c.seen.down).toEqual([{ kind: 'connect', message: 'no answer' }]);
  });
});

describe('CapturePump: a slow connection never makes memory or delay grow', () => {
  it('keeps at most about a second waiting and throws the oldest away', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.accepting = false;
    let fed = 0;
    let worst = 0;
    // thirty seconds of sound in 50 ms pieces, none of it accepted
    for (let i = 0; i < 600; i++) {
      c.net.child.sound(ramp(fed, 2204));
      fed += 2204;
      worst = Math.max(worst, c.pump.backlog);
    }
    expect(worst).toBeLessThanOrEqual(DEFAULT_MAX_BEHIND_BYTES);
    expect(c.pump.backlog).toBeGreaterThan(0);
    // all that was fed is accounted for: handed over (one piece, then it blocked), kept, or dropped
    expect(c.pump.sentBytes + c.pump.backlog + c.pump.droppedBytes).toBe(fed);
    expect(c.pump.droppedBytes).toBeGreaterThan(fed - 2 * DEFAULT_MAX_BEHIND_BYTES);
    c.pump.stop();
  });

  it('when the connection takes sound again, what it gets is the newest sound, in order and complete', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.accepting = false;
    let fed = 0;
    for (let i = 0; i < 200; i++) {
      c.net.child.sound(ramp(fed, 2204));
      fed += 2204;
    }
    c.net.socket.drain();
    expect(c.pump.backlog).toBe(0);
    const after = Buffer.concat(c.net.socket.written.slice(2)); // [AUDIO line, the one piece taken before it blocked, then the rest]
    // the rest ends exactly at the end of what was fed, and is one unbroken stretch of it
    expect(after.length).toBeLessThanOrEqual(DEFAULT_MAX_BEHIND_BYTES);
    expect(after.length).toBeGreaterThan(DEFAULT_MAX_BEHIND_BYTES - 2204);
    expect(after.equals(ramp(fed - after.length, after.length))).toBe(true);
    c.pump.stop();
  });

  it('writes nothing more while the connection is full, and carries on when it drains', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.accepting = false;
    c.net.child.sound(ramp(0, 1000));
    const writesBlocked = c.net.socket.written.length;
    c.net.child.sound(ramp(1000, 1000));
    c.net.child.sound(ramp(2000, 1000));
    expect(c.net.socket.written.length).toBe(writesBlocked);
    c.net.socket.drain();
    expect(Buffer.concat(c.net.socket.written.slice(1)).equals(ramp(0, 3000))).toBe(true);
    c.pump.stop();
  });

  it('sound is kept a whole number of samples: an odd piece waits for its other half, and dropping never shifts the rest by a byte', async () => {
    const c = setup({ maxBehindBytes: 1000 });
    await bringUp(c);
    c.net.socket.accepting = false;
    let at = 0;
    const odd = [3, 5, 7, 1, 11, 9, 13, 201, 1, 301, 55, 77, 1, 1, 999, 3];
    for (let round = 0; round < 12; round++) {
      for (const n of odd) {
        c.net.child.sound(ramp(at, n));
        at += n;
      }
    }
    c.net.socket.drain();
    const pieces = c.net.socket.written.slice(1);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length % 2, 'a piece with an odd length').toBe(0);
      expect(p[0]! % 2, 'a piece that starts in the middle of a sample').toBe(0);
    }
    // the first piece went out before the connection filled up; the rest is one unbroken, sample-aligned stretch up to the last whole sample
    const rest = Buffer.concat(pieces.slice(1));
    expect(rest.length).toBeLessThanOrEqual(1000);
    const endOfWholeSamples = at - (at % 2);
    expect(rest.equals(ramp(endOfWholeSamples - rest.length, rest.length))).toBe(true);
    c.pump.stop();
  });

  it('one piece bigger than the allowance keeps its newest part, whole samples only', async () => {
    const c = setup({ maxBehindBytes: 1000 });
    await bringUp(c);
    c.net.socket.accepting = false;
    c.net.child.sound(ramp(0, 10));
    c.net.child.sound(ramp(10, 5000));
    expect(c.pump.backlog).toBeLessThanOrEqual(1000);
    c.net.socket.drain();
    const rest = Buffer.concat(c.net.socket.written.slice(2));
    expect(rest.length % 2).toBe(0);
    expect(rest.equals(ramp(5010 - rest.length, rest.length))).toBe(true);
    c.pump.stop();
  });

  it('a connection that stays full for 5 seconds is given up on', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.accepting = false;
    c.net.child.sound(ramp(0, 2000));
    await sleepFor(4999);
    expect(c.seen.down).toHaveLength(0);
    await sleepFor(2);
    expect(c.seen.down).toEqual([{ kind: 'closed', message: 'The FM helper stopped taking the sound.' }]);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a connection that drains in time is not given up on', async () => {
    const c = setup();
    await bringUp(c);
    c.net.socket.accepting = false;
    c.net.child.sound(ramp(0, 2000));
    await sleepFor(4000);
    c.net.socket.drain();
    await sleepFor(20_000);
    expect(c.seen.down).toHaveLength(0);
    c.pump.stop();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CapturePump: stop leaves nothing behind', () => {
  it('while streaming: parec is ended, the connection destroyed, no callback, no timer', async () => {
    const c = setup();
    await bringUp(c);
    c.pump.stop();
    expect(c.net.socket.destroyed).toBe(true);
    expect(c.net.child.signals).toEqual(['SIGTERM']);
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(c.seen.down).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(c.pump.phase).toBe('down');
    // late events from the dead are ignored
    c.net.child.sound(ramp(0, 100));
    c.net.socket.reply('OK\n');
    expect(c.seen.streaming).toBe(1);
  });

  it('while still connecting, even before parec has said it started', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.pump.stop();
    expect(vi.getTimerCount()).toBeLessThanOrEqual(0 + 1); // only the kill guard of parec may remain, until it exits
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(c.net.sockets).toHaveLength(0);
    // 'spawn' arriving late must not open a connection
    c.net.child.spawned();
    expect(c.net.sockets).toHaveLength(0);
    expect(c.seen.down).toEqual([]);
  });

  it('while waiting for the answer of the helper', async () => {
    const c = setup();
    c.pump.start();
    await flush();
    c.net.child.spawned();
    c.net.socket.connected();
    c.pump.stop();
    await flush();
    expect(c.net.leftBehind).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await sleepFor(10_000);
    expect(c.seen.down).toEqual([]);
  });

  it('twice, or before it was started, is harmless', async () => {
    const c = setup();
    c.pump.stop();
    c.pump.stop();
    await bringUp(setup());
    const d = setup();
    await bringUp(d);
    d.pump.stop();
    d.pump.stop();
    await flush();
    expect(d.net.child.signals).toEqual(['SIGTERM']);
  });

  it('a parec that ignores SIGTERM is killed after 2 seconds, and the guard timer goes away with it', async () => {
    const c = setup();
    await bringUp(c);
    c.net.child.ignoreTerm = true;
    c.pump.stop();
    await flush();
    expect(c.net.child.signals).toEqual(['SIGTERM']);
    await sleepFor(1999);
    expect(c.net.child.signals).toEqual(['SIGTERM']);
    await sleepFor(2);
    expect(c.net.child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(c.net.leftBehind).toBe(0);
  });

  it('start twice does not make a second parec', async () => {
    const c = setup();
    c.pump.start();
    c.pump.start();
    await flush();
    expect(c.net.children).toHaveLength(1);
    c.pump.stop();
  });
});
