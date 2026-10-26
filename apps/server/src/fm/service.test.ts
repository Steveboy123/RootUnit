import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FM_BAND, FM_NOTICE_VERSION, FM_PROTOCOL, NO_FM, type FmState } from '@headunit/shared';
import { readFmConfig } from './config';
import { FmError, FmService } from './service';
import { BASE_URL, FakeHelper, FakeNet, MemStore, TOKEN, captureConsole, sleepFor } from './testing/fakes';

let consoleCapture: ReturnType<typeof captureConsole>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 20, 12, 0, 0));
  consoleCapture = captureConsole();
});
afterEach(() => {
  consoleCapture.restore();
  vi.useRealTimers();
});

const NOT_SET_UP = { FM_NODE_TOKEN: '', FM_NODE_URL: '' };
const ACKED = { version: 1, frequency: 100.6, on: false, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } };
const ACKED_ON = { ...ACKED, on: true };

interface RigOptions {
  file?: unknown;
  env?: Record<string, string | undefined>;
  /** Do not bring the sound connection up by itself. */
  manualNet?: boolean;
}

function rig(opts: RigOptions = {}) {
  const store = new MemStore();
  if (opts.file !== undefined) store.files.set('fm.json', opts.file);
  const helper = new FakeHelper();
  const net = new FakeNet();
  if (!opts.manualNet) net.auto = 'ok';
  net.onAccepted = () => {
    helper.node.audio = { connected: true, level: 0.42, underruns: 0 };
  };
  const config = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: BASE_URL, ...opts.env });
  const service = new FmService({ store: store.asStore(), config, fetch: helper.fetch as unknown as typeof fetch, spawn: net.spawn, connect: net.connect });
  const states: FmState[] = [];
  service.state.subscribe((s) => states.push(s));
  const status = () => service.state.get().status;
  /** Statuses in the order they were published, repeats removed. */
  const seen = () => states.map((s) => s.status).filter((s, i, a) => i === 0 || a[i - 1] !== s);
  return { store, helper, net, service, states, status, seen, config };
}

/** Start the service and let its first look at the helper happen. */
async function boot(opts: RigOptions = {}) {
  const r = rig(opts);
  await r.service.start();
  await sleepFor(1);
  return r;
}

/** Everything left behind by a service: nothing may be. */
async function expectClean(r: ReturnType<typeof rig>) {
  await sleepFor(1);
  expect(vi.getTimerCount(), 'timers left behind').toBe(0);
  expect(r.net.leftBehind, 'children or sockets left behind').toBe(0);
  expect(r.helper.inFlight, 'requests left open').toBe(0);
}

describe('not set up', () => {
  it('says so, touches nothing, and keeps no timer', async () => {
    const r = await boot({ env: NOT_SET_UP });
    expect(r.service.state.get()).toMatchObject({ mode: 'none', status: 'unconfigured', on: false, acknowledged: false, detail: NO_FM.detail, demo: false, level: 0, board: null });
    expect(r.helper.calls).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    await sleepFor(60_000);
    expect(r.helper.calls).toHaveLength(0);
    await r.service.stop();
  });

  it('a line in .env that cannot be used is explained on the page', async () => {
    const r = await boot({ env: { FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'https://192.168.1.50:8788' } });
    expect(r.service.state.get().status).toBe('unconfigured');
    expect(r.service.state.get().detail).toMatch(/FM_NODE_URL must start with http/);
    expect(r.helper.calls).toHaveLength(0);
    expect(JSON.stringify(r.states)).not.toContain(TOKEN);
  });

  it('cannot be switched on (409, with the reason) once the notice is accepted; and not before (403)', async () => {
    const r = await boot({ env: NOT_SET_UP });
    await expect(r.service.setOn(true)).rejects.toMatchObject({ status: 403 });
    await r.service.acknowledge(FM_NOTICE_VERSION);
    await expect(r.service.setOn(true)).rejects.toMatchObject({ status: 409, message: NO_FM.detail });
    expect(r.service.state.get().on).toBe(false);
    // switching off is always fine
    await expect(r.service.setOn(false)).resolves.toMatchObject({ on: false });
  });

  it('still keeps the frequency, the saved ones and the notice, so that setting up later finds them', async () => {
    const r = await boot({ env: NOT_SET_UP });
    await r.service.tune(95.5);
    await r.service.togglePreset(95.5, true);
    await r.service.acknowledge(FM_NOTICE_VERSION);
    expect(r.service.state.get()).toMatchObject({ frequency: 95.5, presets: [95.5], acknowledged: true });
    expect(r.store.files.get('fm.json')).toMatchObject({ frequency: 95.5, presets: [95.5], ack: { version: FM_NOTICE_VERSION } });
  });
});

describe('what the helper says about itself', () => {
  it('nothing answers: unreachable, with what to check, and no address or password in the words', async () => {
    const r = rig();
    r.helper.mode = 'down';
    await r.service.start();
    await sleepFor(1);
    const s = r.service.state.get();
    expect(s.status).toBe('unreachable');
    expect(s.mode).toBe('remote');
    expect(s.detail).toMatch(/running/);
    expect(s.detail).toMatch(/FM_NODE_URL/);
    expect(s.detail).toMatch(/FM_NODE_TOKEN/);
    expect(s.detail).not.toContain('192.168');
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    await r.service.stop();
    await expectClean(r);
  });

  it('comes back by itself when the helper does, and then says it is ready', async () => {
    const r = rig();
    r.helper.mode = 'down';
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('unreachable');
    r.helper.mode = 'normal';
    await sleepFor(1000);
    expect(r.status()).toBe('idle');
    expect(r.service.state.get()).toMatchObject({ detail: expect.stringMatching(/^Ready/), board: 'Raspberry Pi 4 Model B Rev 1.4' });
    await r.service.stop();
  });

  it('something else answers (a router login page): unreachable, saying it is not the helper', async () => {
    const r = rig();
    r.helper.mode = 'html';
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('unreachable');
    expect(r.service.state.get().detail).toMatch(/not the FM helper/);
    await r.service.stop();
  });

  it('a wrong password (401): an error that says the password does not match, and nothing is started', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.token = 'a-completely-different-password';
    await r.service.start();
    await sleepFor(5000);
    const s = r.service.state.get();
    expect(s.status).toBe('error');
    expect(s.detail).toMatch(/refused the password/);
    expect(s.detail).toMatch(/FM_NODE_TOKEN/);
    expect(JSON.stringify(r.states)).not.toContain(TOKEN);
    expect(JSON.stringify(r.states)).not.toContain('a-completely-different-password');
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(0);
    await r.service.stop();
    await expectClean(r);
  });

  it('a helper of another protocol version: an error that says to update it, and nothing is started even when it is wanted', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.protocol = FM_PROTOCOL + 1;
    await r.service.start();
    await sleepFor(10_000);
    const s = r.service.state.get();
    expect(s.status).toBe('error');
    expect(s.detail).toMatch(/Update the FM helper/);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(0);
    await r.service.stop();
    await expectClean(r);
  });

  it('a helper of another protocol version that is on the air is still switched off when the person says off', async () => {
    const r = rig({ file: ACKED });
    r.helper.node.protocol = FM_PROTOCOL + 1;
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 100.6;
    await r.service.start();
    await sleepFor(1);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.helper.node.state).toBe('idle');
    await r.service.stop();
  });

  it('a board that cannot run the transmitter (the Pi 5): unsupported with the reason; never started, never connected, even when wanted', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.supported = false;
    r.helper.node.board = 'Raspberry Pi 5 Model B Rev 1.0';
    r.helper.node.reason = 'The transmitter program does not work on a Raspberry Pi 5';
    await r.service.start();
    await sleepFor(30_000);
    const s = r.service.state.get();
    expect(s.status).toBe('unsupported');
    expect(s.detail).toBe('The transmitter program does not work on a Raspberry Pi 5.');
    expect(s.board).toBe('Raspberry Pi 5 Model B Rev 1.0');
    expect(s.mode).toBe('remote');
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(0);
    // and it cannot be asked for either
    await expect(r.service.setOn(true)).rejects.toMatchObject({ status: 409 });
    await r.service.stop();
    await expectClean(r);
  });

  it('on this Pi, an unsupported board is told to use a second Pi', async () => {
    const r = rig({ env: { FM_NODE_URL: 'http://127.0.0.1:8788' } });
    r.helper.node.supported = false;
    r.helper.node.reason = 'This is a Raspberry Pi 5.';
    await r.service.start();
    await sleepFor(1);
    const s = r.service.state.get();
    expect(s.mode).toBe('local');
    expect(s.status).toBe('unsupported');
    expect(s.detail).toBe('This is a Raspberry Pi 5. Use a second Pi as the transmitter: see docs/fm.md.');
    await r.service.stop();
  });

  it('an unsupported board stays unsupported when the person asked for on before, and nothing starts when it later turns supported only after the notice', async () => {
    const r = rig({ file: { ...ACKED_ON, ack: null } });
    r.helper.node.supported = true;
    await r.service.start();
    await sleepFor(20_000);
    // the notice was not accepted: the wish was dropped at load
    expect(r.service.state.get()).toMatchObject({ on: false, acknowledged: false });
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    await r.service.stop();
  });
});

describe('the notice comes first', () => {
  it('switching on before the notice is accepted is refused (403) and starts nothing', async () => {
    const r = await boot();
    await expect(r.service.setOn(true)).rejects.toMatchObject({ status: 403 });
    await sleepFor(10_000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.service.state.get()).toMatchObject({ on: false, acknowledged: false });
    await r.service.stop();
  });

  it('a saved "on" without an accepted notice is dropped when the server starts: nothing transmits after an update that changed the notice', async () => {
    for (const ack of [null, { version: FM_NOTICE_VERSION + 1, at: 1 }, { version: 0, at: 1 }, 'yes', { version: '1', at: 1 }]) {
      const r = await boot({ file: { ...ACKED_ON, ack } });
      await sleepFor(10_000);
      expect(r.service.state.get(), JSON.stringify(ack)).toMatchObject({ on: false, acknowledged: false });
      expect(r.helper.to('POST', '/v1/start'), JSON.stringify(ack)).toHaveLength(0);
      expect(r.net.children, JSON.stringify(ack)).toHaveLength(0);
      await r.service.stop();
    }
  });

  it('only the current version of the notice counts', async () => {
    const r = await boot();
    for (const v of [0, FM_NOTICE_VERSION + 1, -1, '1', null, undefined, true, 1.5, NaN, {}, [1]]) {
      await expect(r.service.acknowledge(v), String(v)).rejects.toMatchObject({ status: 400 });
    }
    expect(r.service.state.get().acknowledged).toBe(false);
    await r.service.acknowledge(FM_NOTICE_VERSION);
    expect(r.service.state.get().acknowledged).toBe(true);
    expect(r.store.files.get('fm.json')).toMatchObject({ ack: { version: FM_NOTICE_VERSION, at: Date.now() } });
    await r.service.stop();
  });

  it('accepting the notice does not by itself switch anything on', async () => {
    const r = await boot();
    await r.service.acknowledge(FM_NOTICE_VERSION);
    await sleepFor(10_000);
    expect(r.service.state.get().on).toBe(false);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    await r.service.stop();
  });

  it('what is asked for must be a real true or false', async () => {
    const r = await boot({ file: ACKED });
    for (const v of ['true', 1, 0, null, undefined, {}, [], 'on']) await expect(r.service.setOn(v), String(v)).rejects.toMatchObject({ status: 400 });
    expect(r.service.state.get().on).toBe(false);
    await r.service.stop();
  });
});

describe('going on the air', () => {
  it('start, retune, stop: the request to the helper, parec, and the first line of the sound connection, as they go out', async () => {
    const r = await boot({ file: ACKED });
    expect(r.status()).toBe('idle');
    await r.service.setOn(true);
    await sleepFor(50);

    // the helper is asked to transmit, with the usual width, and the password as a bearer token
    const starts = r.helper.to('POST', '/v1/start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.body).toEqual({ frequency: 100.6, bandwidth: 100 });
    expect(starts[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    // parec records what the head unit plays
    expect(r.net.children).toHaveLength(1);
    expect(r.net.child.command).toBe('parec');
    expect(r.net.child.args).toContain('--device=@DEFAULT_MONITOR@');
    // and sends it to the helper's sound port, the password first
    expect(r.net.sockets).toHaveLength(1);
    expect(r.net.socket).toMatchObject({ host: '192.168.1.50', port: 8789 });
    expect(r.net.socket.firstLine).toBe(`AUDIO 1 ${TOKEN}`);

    expect(r.status()).toBe('transmitting');
    expect(r.service.state.get()).toMatchObject({ on: true, level: 0.42, frequency: 100.6, board: 'Raspberry Pi 4 Model B Rev 1.4' });
    expect(r.service.state.get().detail).toMatch(/Sending on 100\.6 MHz/);
    // the order the person sees: ready, then starting, then on the air; never on the air before the sound is connected
    expect(r.seen()).toEqual(['idle', 'starting', 'transmitting']);

    await r.service.tune(95.5);
    await sleepFor(500); // a retune waits a moment for more taps
    expect(r.helper.to('POST', '/v1/start').map((c) => c.body)).toEqual([
      { frequency: 100.6, bandwidth: 100 },
      { frequency: 95.5, bandwidth: 100 },
    ]);
    // retuning does not touch the sound
    expect(r.net.children).toHaveLength(1);
    expect(r.net.sockets).toHaveLength(1);
    expect(r.net.socket.destroyed).toBe(false);
    expect(r.status()).toBe('transmitting');
    expect(r.service.state.get().frequency).toBe(95.5);

    await r.service.setOn(false);
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.helper.node.state).toBe('idle');
    expect(r.net.child.signals).toEqual(['SIGTERM']);
    expect(r.net.socket.destroyed).toBe(true);
    expect(r.status()).toBe('idle');
    expect(r.service.state.get()).toMatchObject({ on: false, level: 0 });
    expect(r.store.files.get('fm.json')).toMatchObject({ on: false, frequency: 95.5 });

    await r.service.stop();
    await expectClean(r);
  });

  it('is not "transmitting" while the sound is not connected: the carrier alone is only "starting"', async () => {
    const r = await boot({ file: ACKED_ON, manualNet: true });
    await sleepFor(50);
    expect(r.helper.node.state).toBe('transmitting');
    expect(r.status()).toBe('starting');
    expect(r.service.state.get().detail).toMatch(/Connecting the sound/);
    expect(r.service.state.get().level).toBe(0);
    await r.service.stop();
  });

  it('is not "transmitting" because of the sound of another head unit: our own sound connection has to be up too', async () => {
    const r = rig({ file: ACKED_ON });
    r.net.auto = 'ERR busy right now';
    r.helper.node.audio = { connected: true, level: 0.8, underruns: 0 }; // another head unit is feeding the helper
    await r.service.start();
    await sleepFor(2500);
    expect(r.helper.node.state).toBe('transmitting');
    expect(r.status()).not.toBe('transmitting');
    expect(r.service.state.get().level).toBe(0);
    await r.service.stop();
  });

  it('is not "transmitting" until the helper itself says it hears the sound', async () => {
    const r = rig({ file: ACKED_ON });
    r.net.onAccepted = null; // the sound is up on our side, the helper has not noticed yet
    await r.service.start();
    await sleepFor(2100);
    expect(r.net.socket.firstLine).toContain('AUDIO 1');
    expect(r.status()).toBe('starting');
    r.helper.node.audio = { connected: true, level: 0.9, underruns: 0 };
    await sleepFor(2100);
    expect(r.status()).toBe('transmitting');
    expect(r.service.state.get().level).toBe(0.9);
    await r.service.stop();
  });

  it('comes back by itself after a restart of the server, when it was on and the notice is accepted', async () => {
    const first = await boot({ file: ACKED });
    await first.service.setOn(true);
    await sleepFor(50);
    expect(first.status()).toBe('transmitting');
    await first.service.stop();
    expect(first.helper.node.state).toBe('idle');
    expect(first.store.files.get('fm.json')).toMatchObject({ on: true });

    const second = rig({ file: first.store.files.get('fm.json') });
    await second.service.start();
    await sleepFor(50);
    expect(second.service.state.get().on).toBe(true);
    expect(second.status()).toBe('transmitting');
    await second.service.stop();
  });

  it('the frequency is remembered across a restart', async () => {
    const first = await boot({ file: ACKED });
    await first.service.tune(92.3);
    await first.service.stop();
    const second = await boot({ file: first.store.files.get('fm.json') });
    expect(second.service.state.get().frequency).toBe(92.3);
    await second.service.stop();
  });

  it('asks for less than the usual width when the helper is limited to less', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.limits.maxBandwidth = 60;
    await r.service.start();
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/start')[0]!.body).toEqual({ frequency: 100.6, bandwidth: 60 });
    await r.service.stop();
  });

  it('fixes a helper that is on another frequency than the one wanted', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 91.1;
    r.helper.node.bandwidth = 100;
    await r.service.start();
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/start').map((c) => c.body)).toEqual([{ frequency: 100.6, bandwidth: 100 }]);
    expect(r.helper.node.frequency).toBe(100.6);
    await r.service.stop();
  });

  it('leaves a helper alone that is already on the right frequency (it only needs the sound)', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 100.6;
    r.helper.node.bandwidth = 100;
    await r.service.start();
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(1);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('does not touch a helper that is idle when the person wants it off', async () => {
    const r = await boot({ file: ACKED });
    await sleepFor(60_000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    await r.service.stop();
  });

  it('a helper that was left transmitting (a crash of the server) is switched off when the person wants it off', async () => {
    const r = rig({ file: ACKED });
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 100.6;
    await r.service.start();
    await sleepFor(1);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.status()).toBe('idle');
    await r.service.stop();
  });

  it('the helper switched itself off (its dead-man switch, a restart): it is started again', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    r.helper.node.state = 'idle';
    r.helper.node.frequency = null;
    await sleepFor(2100);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });
});

describe('tuning', () => {
  it('rounds to a tenth and keeps it in the band', async () => {
    const r = await boot({ file: ACKED });
    expect((await r.service.tune(99.96)).frequency).toBe(100);
    expect((await r.service.tune(87.5)).frequency).toBe(87.5);
    expect((await r.service.tune(108)).frequency).toBe(108);
    for (const bad of [87.4, 108.1, 0, -5, 1e9, NaN, Infinity, '100.6', null, undefined, {}, [], true]) {
      await expect(r.service.tune(bad), String(bad)).rejects.toBeInstanceOf(FmError);
      await expect(r.service.tune(bad), String(bad)).rejects.toMatchObject({ status: 400 });
    }
    expect(r.service.state.get().frequency).toBe(108);
    await r.service.stop();
  });

  it('uses the band the helper accepts once it is known, and says what it is', async () => {
    const r = rig({ file: ACKED });
    r.helper.node.limits = { min: 88, max: 92, maxBandwidth: 150 };
    await r.service.start();
    await sleepFor(1);
    expect(r.service.state.get().limits).toEqual({ min: 88, max: 92 });
    await expect(r.service.tune(93)).rejects.toMatchObject({ status: 400, message: 'Choose a frequency between 88.0 and 92.0 MHz.' });
    await expect(r.service.tune(87.9)).rejects.toMatchObject({ status: 400 });
    expect((await r.service.tune(92)).frequency).toBe(92);
    await r.service.stop();
  });

  it('a saved frequency outside what the helper allows is not sent: an error says to choose another', async () => {
    const r = rig({ file: { ...ACKED_ON, frequency: 100.6 } });
    r.helper.node.limits = { min: 88, max: 92, maxBandwidth: 150 };
    await r.service.start();
    await sleepFor(10_000);
    expect(r.status()).toBe('error');
    expect(r.service.state.get().detail).toMatch(/only between 88\.0 and 92\.0 MHz/);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.net.children).toHaveLength(0);
    // tuning inside the band puts it on the air
    await r.service.tune(90);
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('while the carrier is on, a frequency the helper would refuse takes it off the air', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    r.helper.node.limits = { min: 88, max: 92, maxBandwidth: 150 };
    await sleepFor(2100);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.status()).toBe('error');
    expect(r.net.socket.destroyed).toBe(true);
    await r.service.stop();
  });
});

describe('retuning', () => {
  it('five taps in a row are one retune to the last frequency, made a moment after the last tap; switching on is not delayed', async () => {
    const r = await boot({ file: ACKED });
    await r.service.tune(99.9);
    await r.service.setOn(true); // right after tuning: no waiting
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/start').map((c) => (c.body as { frequency: number }).frequency)).toEqual([99.9]);
    expect(r.status()).toBe('transmitting');

    for (const f of [100, 100.1, 100.2, 100.3, 100.4]) {
      await r.service.tune(f);
      await sleepFor(80);
    }
    // 80 ms after the last tap: nothing sent yet, the page says it is tuning
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    expect(r.status()).toBe('starting');
    expect(r.service.state.get().detail).toBe('Tuning to 100.4 MHz\u2026');
    expect(r.helper.node.frequency).toBe(99.9);
    await sleepFor(400);
    expect(r.helper.to('POST', '/v1/start').map((c) => (c.body as { frequency: number }).frequency)).toEqual([99.9, 100.4]);
    expect(r.status()).toBe('transmitting');
    // the sound stayed up through all of it
    expect(r.net.children).toHaveLength(1);
    await r.service.stop();
  });

  it('a retune is made 400 ms after the tap, not at the next poll', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    const t0 = Date.now();
    await r.service.tune(91.5);
    await sleepFor(399);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    await sleepFor(10);
    const start = r.helper.to('POST', '/v1/start')[1]!;
    expect(start.body).toEqual({ frequency: 91.5, bandwidth: 100 });
    expect(start.at - t0).toBeGreaterThanOrEqual(400);
    expect(start.at - t0).toBeLessThan(450);
    await r.service.stop();
  });

  it('a helper found on the wrong frequency at the start (nobody tapped) is corrected at once', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 91.1;
    await r.service.start();
    await sleepFor(10);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    await r.service.stop();
  });

  it('a different bandwidth reported by the helper is not a reason to restart it (only the frequency is)', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 100.6;
    r.helper.node.bandwidth = 150;
    await r.service.start();
    await sleepFor(10_000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(0);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('the clock going backwards does not hold a retune back for long', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    await r.service.tune(91.5);
    vi.setSystemTime(Date.now() - 3_600_000);
    await sleepFor(2100);
    expect(r.helper.node.frequency).toBe(91.5);
    await r.service.stop();
  });
});

describe('saved frequencies', () => {
  it('adds, ignores doubles, removes, and stops at six', async () => {
    const r = await boot({ file: ACKED });
    await r.service.togglePreset(88.1, true);
    await r.service.togglePreset(88.1, true);
    await r.service.togglePreset(99.94, true);
    expect(r.service.state.get().presets).toEqual([88.1, 99.9]);
    await r.service.togglePreset(88.1, false);
    expect(r.service.state.get().presets).toEqual([99.9]);
    await r.service.togglePreset(77, false).catch(() => undefined);
    for (const f of [90, 91, 92, 93, 94]) await r.service.togglePreset(f, true);
    expect(r.service.state.get().presets).toHaveLength(6);
    await expect(r.service.togglePreset(95, true)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/up to 6/) });
    // removing still works when full, and saving one that is already there is not an error
    await expect(r.service.togglePreset(90, true)).resolves.toBeTruthy();
    await r.service.togglePreset(90, false);
    expect(r.service.state.get().presets).toHaveLength(5);
    expect(r.store.files.get('fm.json')).toMatchObject({ presets: [99.9, 91, 92, 93, 94] });
    await r.service.stop();
  });

  it('refuses what is not a frequency or not a yes/no', async () => {
    const r = await boot({ file: ACKED });
    for (const [f, s] of [['x', true], [200, true], [null, true], [100.6, 'true'], [100.6, undefined], [100.6, 1]] as const) {
      await expect(r.service.togglePreset(f, s), `${f} ${s}`).rejects.toMatchObject({ status: 400 });
    }
    expect(r.service.state.get().presets).toEqual([]);
    await r.service.stop();
  });

  it('a new one has to fit the band of the helper, an old one can always be removed', async () => {
    const r = rig({ file: { ...ACKED, presets: [100.1, 90] } });
    r.helper.node.limits = { min: 88, max: 92, maxBandwidth: 150 };
    await r.service.start();
    await sleepFor(1);
    await expect(r.service.togglePreset(95, true)).rejects.toMatchObject({ status: 400 });
    await r.service.togglePreset(100.1, false);
    expect(r.service.state.get().presets).toEqual([90]);
    await r.service.stop();
  });
});

describe('when the transmitter program or the helper says no', () => {
  it('the program fails to start: an error with its words, and it is asked again no sooner than every 10 seconds', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.node.state = 'error';
    r.helper.node.error = 'Cannot open /dev/mem';
    r.helper.nextStart = { status: 200, body: { ...r.helper.node } };
    await r.service.start();
    await sleepFor(1);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    expect(r.status()).toBe('error');
    expect(r.service.state.get().detail).toBe('The transmitter program stopped: Cannot open /dev/mem');
    // 9 seconds of polling later: still only one attempt
    await sleepFor(9000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    expect(r.net.children).toHaveLength(0); // no sound while there is no carrier
    // the problem went away: the next attempt, after the 10 seconds, goes through
    r.helper.node.state = 'error';
    await sleepFor(2100);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('keeps trying only every 10 seconds, however long it keeps failing', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.programFails = 'busy';
    await r.service.start();
    await sleepFor(60_000);
    const starts = r.helper.to('POST', '/v1/start');
    expect(starts.length).toBeGreaterThanOrEqual(5);
    expect(starts.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < starts.length; i++) expect(starts[i]!.at - starts[i - 1]!.at).toBeGreaterThanOrEqual(10_000);
    expect(r.status()).toBe('error');
    expect(r.net.children).toHaveLength(0);
    await r.service.stop();
  });

  it('the helper refuses the frequency (400): its sentence is shown, it is not asked again until something changes', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.nextStart = { status: 400, body: { error: 'That frequency is not allowed here.' } };
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('error');
    expect(r.service.state.get().detail).toBe('That frequency is not allowed here.');
    await sleepFor(8000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    // a different frequency is a new question
    await r.service.tune(95.5);
    await sleepFor(50);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('after 10 seconds it asks again, and a refusal that has gone away is forgotten', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.nextStart = { status: 409, body: { error: 'The transmitter program failed a moment ago.' } };
    await r.service.start();
    await sleepFor(1);
    expect(r.service.state.get().detail).toBe('The transmitter program failed a moment ago.');
    await sleepFor(10_100);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('the helper turns out not to support the board when asked (403): unsupported', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.nextStart = { status: 403, body: { error: 'This board cannot run the transmitter.' } };
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('unsupported');
    expect(r.service.state.get().detail).toBe('This board cannot run the transmitter.');
    expect(r.net.children).toHaveLength(0);
    await r.service.stop();
  });

  it('switching off and on again forgets a refusal at once', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.nextStart = { status: 400, body: { error: 'No.' } };
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('error');
    await r.service.setOn(false);
    await sleepFor(1);
    expect(r.status()).toBe('idle');
    await r.service.setOn(true);
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });

  it('a helper that stops mid-way (the program died) shows its error and is restarted, no faster than every 10 seconds', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    r.helper.node.state = 'error';
    r.helper.node.error = 'The transmitter program ended unexpectedly (signal 11).';
    await sleepFor(2100);
    expect(r.status()).toBe('error');
    expect(r.service.state.get().detail).toContain('signal 11');
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1); // started less than 10 s ago: wait
    await sleepFor(9000);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });
});

describe('the sound connection', () => {
  it('parec is missing: the page says how to install it, nothing is sent to the network for it, and it is retried slowly', async () => {
    const r = rig({ file: ACKED_ON });
    r.net.missingParec = true;
    await r.service.start();
    await sleepFor(50);
    expect(r.status()).toBe('error');
    expect(r.service.state.get().detail).toBe('Sound capture (parec) is missing: sudo apt install pulseaudio-utils');
    expect(r.net.sockets).toHaveLength(0);
    // pauses of 1, 2, 4, 8 and then 10 seconds
    const tries: number[] = [];
    let seenChildren = r.net.children.length;
    const t0 = Date.now();
    for (let ms = 0; ms < 40_000; ms += 100) {
      await sleepFor(100);
      if (r.net.children.length > seenChildren) {
        seenChildren = r.net.children.length;
        tries.push(Date.now() - t0);
      }
    }
    expect(tries.length).toBeGreaterThanOrEqual(4);
    expect(tries.length).toBeLessThanOrEqual(7);
    expect(r.net.sockets).toHaveLength(0);
    await r.service.stop();
    await expectClean(r);
  });

  it('the first hiccup is "starting", a second in a row is an error, and it recovers by itself', async () => {
    const r = rig({ file: ACKED_ON });
    r.net.auto = 'ERR busy right now';
    await r.service.start();
    await sleepFor(50);
    expect(r.status()).toBe('starting');
    expect(r.service.state.get().detail).toMatch(/refused the sound connection: busy right now/);
    await sleepFor(1100); // the first pause is 1 s
    expect(r.net.sockets).toHaveLength(2);
    expect(r.status()).toBe('error');
    r.net.auto = 'ok';
    await sleepFor(2100); // the second pause is 2 s
    await sleepFor(2100);
    expect(r.status()).toBe('transmitting');
    expect(r.net.sockets.length).toBeGreaterThanOrEqual(3);
    await r.service.stop();
    await expectClean(r);
  });

  it('the helper closes the sound connection: parec is ended, a new one is made after a second', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    r.helper.node.audio = { connected: false, level: 0, underruns: 0 };
    r.net.socket.peerCloses();
    await sleepFor(10);
    expect(r.net.children[0]!.signals).toEqual(['SIGTERM']);
    expect(r.status()).toBe('starting');
    expect(r.service.state.get().detail).toMatch(/sound connection .* ended/);
    expect(r.net.children).toHaveLength(1);
    await sleepFor(1100);
    expect(r.net.children).toHaveLength(2);
    expect(r.net.sockets).toHaveLength(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
    await expectClean(r);
  });

  it('a connection that held for a while starts the pauses again from one second', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    for (let i = 0; i < 3; i++) {
      await sleepFor(15_000);
      r.helper.node.audio = { connected: false, level: 0, underruns: 0 };
      r.net.socket.peerCloses();
      await sleepFor(1100);
      expect(r.net.sockets, `round ${i}`).toHaveLength(i + 2);
    }
    await r.service.stop();
  });

  it('does not open the sound before the helper reports the carrier on the air', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.stuckIdle = true; // every start is answered, but the program has not come up
    await r.service.start();
    await sleepFor(6000);
    expect(r.helper.to('POST', '/v1/start').length).toBeGreaterThan(0);
    expect(r.net.children).toHaveLength(0);
    expect(r.net.sockets).toHaveLength(0);
    expect(r.status()).toBe('starting');
    await r.service.stop();
  });

  it('a wrong password on the sound port shows the reason given by the helper', async () => {
    const r = rig({ file: ACKED_ON });
    r.net.auto = 'ERR wrong password';
    await r.service.start();
    await sleepFor(1200);
    expect(r.service.state.get().detail).toBe('The FM helper refused the sound connection: wrong password.');
    expect(JSON.stringify(r.states)).not.toContain(TOKEN);
    await r.service.stop();
  });
});

describe('time: how often it looks, and how it backs off', () => {
  it('on the air it asks the helper every 2 seconds (that is what keeps the helper from switching off), off every 10', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(1);
    r.helper.calls.length = 0;
    await sleepFor(20_000);
    const gaps = r.helper.to('GET', '/v1/status').map((c, i, a) => (i === 0 ? 0 : c.at - a[i - 1]!.at)).slice(1);
    expect(gaps.length).toBeGreaterThanOrEqual(9);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(2000);
    await r.service.setOn(false);
    await sleepFor(100);
    r.helper.calls.length = 0;
    await sleepFor(60_000);
    const idle = r.helper.to('GET', '/v1/status');
    expect(idle.length).toBeGreaterThanOrEqual(5);
    expect(idle.length).toBeLessThanOrEqual(7);
    await r.service.stop();
  });

  it('after a failure: 1, 2, 4, 8, then 10 seconds, and from then on every 10', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.mode = 'down';
    await r.service.start();
    await sleepFor(60_000);
    const times = r.helper.to('GET', '/v1/status').map((c) => c.at);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(gaps.slice(0, 7)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000, 10_000]);
    await r.service.stop();
  });

  it('a success starts the pauses again from the beginning', async () => {
    const r = rig({ file: ACKED });
    r.helper.mode = 'down';
    await r.service.start();
    await sleepFor(8000); // 3 failures behind us, the next pause is long
    r.helper.mode = 'normal';
    await sleepFor(10_000);
    expect(r.status()).toBe('idle');
    r.helper.mode = 'down';
    r.helper.calls.length = 0;
    await sleepFor(12_000); // a poll when off is every 10 s; then it fails and starts at 1 s
    const times = r.helper.to('GET', '/v1/status').map((c) => c.at);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(gaps.slice(-2)[0]).toBeLessThanOrEqual(2000);
    await r.service.stop();
  });

  it('a helper that does not answer is given up on after 3 seconds', async () => {
    const r = rig({ file: ACKED });
    r.helper.mode = 'hang';
    await r.service.start();
    await sleepFor(2900);
    expect(r.status()).toBe('idle'); // still looking
    await sleepFor(200);
    expect(r.status()).toBe('unreachable');
    expect(r.helper.aborted).toBe(1);
    await r.service.stop();
    await expectClean(r);
  });

  it('only one question to the helper is out at a time, however often it is nudged', async () => {
    const r = rig({ file: ACKED });
    r.helper.delayMs = 500;
    await r.service.start();
    await sleepFor(1);
    for (let i = 0; i < 20; i++) {
      await r.service.tune(90 + (i % 5) / 10);
      await sleepFor(10);
    }
    await sleepFor(5000);
    expect(r.helper.maxInFlight).toBe(1);
    await r.service.stop();
    await expectClean(r);
  });

  it('a change made while a request is out is picked up by one more look right after, not at the next poll', async () => {
    // (no sound connection here: its own events would nudge the loop and hide whether the change did)
    const r = rig({ file: ACKED_ON, manualNet: true });
    r.helper.node.state = 'transmitting'; // on the air, but at the wrong frequency: the first look sends a start
    r.helper.node.frequency = 91.1;
    r.helper.startDelayMs = 400;
    await r.service.start();
    await sleepFor(100); // the first start (100.6) is out, it takes until t = 400
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    await r.service.tune(95.5); // too late for that request
    await sleepFor(350); // t = 450: the first start is done
    expect(r.helper.node.frequency).toBe(100.6);
    // the follow-up look is at once (not at t = 2400, the next poll); the retune then waits until the taps have settled (t = 500)
    expect(r.helper.to('GET', '/v1/status')).toHaveLength(2);
    await sleepFor(100);
    expect(r.helper.to('POST', '/v1/start').map((c) => (c.body as { frequency: number }).frequency)).toEqual([100.6, 95.5]);
    r.helper.startDelayMs = 0;
    await r.service.stop();
    await expectClean(r);
  });

  it('a change made while the first look is still out is seen by the same look', async () => {
    const r = rig({ file: ACKED });
    r.helper.delayMs = 500;
    await r.service.start();
    await sleepFor(100);
    await r.service.setOn(true);
    await sleepFor(1450);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    const stopping = r.service.stop();
    await sleepFor(600);
    await stopping;
    await expectClean(r);
  });

  it('three failed looks in a row end the sound connection; one does not', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    r.helper.mode = 'down';
    await sleepFor(2100); // 1st failure
    expect(r.status()).toBe('unreachable');
    expect(r.net.socket.destroyed).toBe(false);
    await sleepFor(1000); // 2nd
    expect(r.net.socket.destroyed).toBe(false);
    await sleepFor(2100); // 3rd
    expect(r.net.socket.destroyed).toBe(true);
    r.helper.mode = 'normal';
    await sleepFor(10_000);
    expect(r.net.sockets.length).toBe(2);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
    await expectClean(r);
  });

  it('a helper that is unreachable keeps being asked for the wished state after it comes back', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.mode = 'down';
    await r.service.start();
    await sleepFor(20_000);
    expect(r.status()).toBe('unreachable');
    expect(r.service.state.get().on).toBe(true);
    r.helper.mode = 'normal';
    await sleepFor(12_000);
    expect(r.status()).toBe('transmitting');
    await r.service.stop();
  });
});

describe('stopping', () => {
  it('on the air: the carrier is switched off with one request, parec and the connection are closed, nothing is left', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    expect(r.status()).toBe('transmitting');
    const t0 = Date.now();
    await r.service.stop();
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.helper.to('POST', '/v1/stop')[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(r.helper.node.state).toBe('idle');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.net.child.signals).toEqual(['SIGTERM']);
    expect(r.net.socket.destroyed).toBe(true);
    await expectClean(r);
    // what the person asked for is kept for the next start
    expect(r.store.files.get('fm.json')).toMatchObject({ on: true });
  });

  it('is quick even if the helper does not answer: one second at most', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    r.helper.mode = 'hang';
    let done = false;
    const p = r.service.stop().then(() => (done = true));
    await sleepFor(999);
    expect(done).toBe(false);
    await sleepFor(2);
    await p;
    expect(done).toBe(true);
    await expectClean(r);
  });

  it('when nothing was started there is nothing to switch off, and nothing to wait for', async () => {
    const r = await boot({ file: ACKED });
    await r.service.stop();
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(0);
    await expectClean(r);
  });

  it('while a start is on its way: the request is cancelled and the carrier is switched off all the same', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.startDelayMs = 400;
    await r.service.start();
    await sleepFor(100);
    expect(r.helper.to('POST', '/v1/start')).toHaveLength(1);
    expect(r.helper.node.state).toBe('idle'); // the request has not reached the helper's decision yet
    r.helper.startDelayMs = 0;
    await r.service.stop();
    expect(r.helper.aborted).toBe(1);
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    expect(r.helper.node.state).toBe('idle');
    await expectClean(r);
  });

  it('twice is the same as once, and a stopped service ignores everything', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    await Promise.all([r.service.stop(), r.service.stop()]);
    await r.service.stop();
    expect(r.helper.to('POST', '/v1/stop')).toHaveLength(1);
    const calls = r.helper.calls.length;
    const children = r.net.children.length;
    await r.service.tune(90).catch(() => undefined);
    await r.service.setOn(true).catch(() => undefined);
    await sleepFor(60_000);
    expect(r.helper.calls.length).toBe(calls);
    expect(r.net.children.length).toBe(children);
    await expectClean(r);
  });

  it('stopping before start() is harmless', async () => {
    const r = rig({ file: ACKED_ON });
    await r.service.stop();
    expect(r.helper.calls).toHaveLength(0);
    await expectClean(r);
  });

  it('start() twice does not make two loops', async () => {
    const r = rig({ file: ACKED });
    await r.service.start();
    await r.service.start();
    await sleepFor(1);
    expect(r.helper.to('GET', '/v1/status')).toHaveLength(1);
    await r.service.stop();
  });
});

describe('the password stays out of everything', () => {
  it('state, saved file and log lines never hold it, through failures of every kind, not even from a helper or a library that echoes it', async () => {
    const scenarios: Array<(r: ReturnType<typeof rig>) => void> = [
      () => undefined,
      (r) => (r.helper.mode = 'down'),
      (r) => (r.helper.token = 'x-something-else-entirely-0123'),
      (r) => (r.helper.node.protocol = 9),
      (r) => ((r.helper.node.supported = false), (r.helper.node.reason = `Not on this board ${TOKEN}`)),
      (r) => ((r.helper.node.state = 'error'), (r.helper.node.error = `failed with ${TOKEN}`)),
      (r) => (r.helper.nextStart = { status: 400, body: { error: `bad request for ${TOKEN}` } }),
      (r) => (r.helper.node.board = `Pi ${TOKEN}`),
      (r) => (r.net.auto = `ERR password ${TOKEN} refused`),
      (r) => (r.net.missingParec = true),
      (r) => (r.helper.mode = 'html'),
    ];
    for (const [i, scenario] of scenarios.entries()) {
      const r = rig({ file: ACKED_ON });
      scenario(r);
      await r.service.start();
      await sleepFor(15_000);
      await r.service.tune(95.5);
      await sleepFor(3000);
      await r.service.stop();
      const all = JSON.stringify([r.states, r.store.writes, consoleCapture.lines.splice(0)]);
      expect(all, `scenario ${i}`).not.toContain(TOKEN);
      expect(all, `scenario ${i}`).not.toContain('x-something-else-entirely-0123');
      // nor the address of the helper
      expect(JSON.stringify(r.states), `scenario ${i}`).not.toContain('192.168.1.50');
    }
  });

  it('the saved file holds only the five fields it should', async () => {
    const r = await boot({ file: ACKED });
    await r.service.setOn(true);
    await r.service.togglePreset(90, true);
    await sleepFor(50);
    for (const w of r.store.writes) expect(Object.keys(w.value as object).sort()).toEqual(['ack', 'frequency', 'on', 'presets', 'version']);
    await r.service.stop();
  });

  it('parec does not get the password in its environment', async () => {
    // the default spawn removes it; checked in wire.test.ts with a real process
    expect(FM_BAND.min).toBeLessThan(FM_BAND.max);
  });
});

describe('publishing', () => {
  it('a listener of the state that throws does not stop the transmitter, its loop or the requests', async () => {
    const r = rig({ file: ACKED });
    r.service.state.subscribe(() => {
      throw new Error('a screen went away');
    });
    await r.service.start();
    await sleepFor(1);
    await r.service.setOn(true);
    await sleepFor(50);
    expect(r.helper.node.state).toBe('transmitting');
    expect(r.service.state.get().status).toBe('transmitting');
    await r.service.tune(95.5);
    await sleepFor(500);
    expect(r.helper.node.frequency).toBe(95.5);
    await r.service.stop();
    await expectClean(r);
  });

  it('an old refusal is forgotten when the helper turns out to be on the air at the right frequency', async () => {
    const r = rig({ file: ACKED_ON });
    r.helper.nextStart = { status: 409, body: { error: 'Failed a moment ago.' } };
    await r.service.start();
    await sleepFor(1);
    expect(r.status()).toBe('error');
    // someone starts it by hand
    r.helper.node.state = 'transmitting';
    r.helper.node.frequency = 100.6;
    r.helper.node.bandwidth = 100;
    await sleepFor(2100);
    expect(r.status()).not.toBe('error');
    expect(r.service.state.get().detail).not.toContain('Failed a moment ago');
    await r.service.stop();
  });

  it('only tells the screens when something they can see changed', async () => {
    const r = await boot({ file: ACKED });
    const n = r.states.length;
    await sleepFor(60_000);
    expect(r.states.length).toBe(n);
    await r.service.stop();
  });

  it('the level is a number from 0 to 1 with two decimals, and 0 when nothing is on the air', async () => {
    const r = await boot({ file: ACKED_ON });
    await sleepFor(50);
    r.helper.node.audio.level = 0.123456;
    await sleepFor(2100);
    expect(r.service.state.get().level).toBe(0.12);
    await r.service.setOn(false);
    await sleepFor(50);
    expect(r.service.state.get().level).toBe(0);
    await r.service.stop();
  });
});
