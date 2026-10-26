import { afterEach, describe, expect, it } from 'vitest';
import { Elm327, ElmError } from './elm';
import { TcpTransport } from './transport';
import { startElmEmulator, type EmuValues, type EmulatorOptions } from './testing/elmEmulator';

const car: EmuValues = { rpm: 1726, speedKmh: 88, coolantC: 83, intakeC: 30, throttlePct: 20, loadPct: 45, fuelPct: 60, batteryV: 14.4, ambientC: 21 };

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

async function setup(over: Partial<EmulatorOptions> = {}, timeoutMs = 1500) {
  const emu = await startElmEmulator({ values: () => car, ...over });
  const t = new TcpTransport('127.0.0.1', emu.port);
  await t.open();
  const elm = new Elm327(t, timeoutMs);
  cleanup.push(() => elm.close(), () => emu.close());
  return { emu, elm };
}
const kind = async (p: Promise<unknown>) => p.then(() => 'ok', (e: ElmError) => e.kind);

describe('Elm327 against the emulator', () => {
  it('initialises the adapter even though echo is on at first', async () => {
    const { elm, emu } = await setup();
    const info = await elm.init();
    expect(info.adapter).toMatch(/ELM327/);
    expect(emu.log).toEqual(['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0', 'ATAT1']);
  });

  it('tolerates clones that answer ? to ATAT1', async () => {
    const { elm } = await setup({ noAdaptiveTiming: true });
    await expect(elm.init()).resolves.toBeTruthy();
  });

  it('finds the car and reports the protocol (CAN)', async () => {
    const { elm } = await setup();
    await elm.init();
    expect(await elm.connectEcu()).toEqual({ protocol: 'ISO 15765-4 (CAN 11/500)', can: true });
  });

  it('knows older protocols are not CAN', async () => {
    const { elm } = await setup({ protocol: 'iso' });
    await elm.init();
    expect(await elm.connectEcu()).toMatchObject({ protocol: 'ISO 9141-2', can: false });
  });

  it('reads PIDs and decodes them to the pretend car\'s values', async () => {
    const { elm } = await setup();
    await elm.init();
    await elm.connectEcu();
    expect(await elm.pid(0x0c)).toEqual([0x1a, 0xf8]); // 1726 rpm
    expect(await elm.pid(0x0d)).toEqual([88]);
    expect(await elm.pid(0x05)).toEqual([123]); // 83 °C + 40
  });

  it('reports a PID the car lacks as NO DATA', async () => {
    const { elm } = await setup({ supported: [0x0c, 0x0d] });
    await elm.init();
    await elm.connectEcu();
    expect(await kind(elm.pid(0x2f))).toBe('no-data');
  });

  it('reports ignition-off as "unable to connect"', async () => {
    const { elm } = await setup({ ecuOn: () => false });
    await elm.init();
    expect(await kind(elm.connectEcu())).toBe('unable');
  });

  it('maps a negative response to a readable reason', async () => {
    const { elm } = await setup({ refuseClearWhenRunning: true });
    await elm.init();
    await elm.connectEcu();
    const err = await elm.cmd('04').catch((e: ElmError) => e);
    expect(err).toBeInstanceOf(ElmError);
    expect((err as ElmError).kind).toBe('negative');
    expect((err as ElmError).message).toMatch(/engine off/);
  });

  it('times out when the adapter never answers', async () => {
    const { elm } = await setup({ mute: true }, 150);
    expect(await kind(elm.cmd('ATZ'))).toBe('timeout');
  });

  it('fails queued commands cleanly when the link drops', async () => {
    const { elm, emu } = await setup({ latencyMs: 60 });
    await elm.init();
    const pending = kind(elm.cmd('010C'));
    setTimeout(() => emu.dropClients(), 20);
    expect(await pending).toBe('closed');
    expect(await kind(elm.cmd('010D'))).toBe('closed');
  });

  it('serialises commands issued concurrently (replies never mix)', async () => {
    const { elm } = await setup({ latencyMs: 10 });
    await elm.init();
    await elm.connectEcu();
    const [rpm, speed, coolant] = await Promise.all([elm.pid(0x0c), elm.pid(0x0d), elm.pid(0x05)]);
    expect(rpm).toEqual([0x1a, 0xf8]);
    expect(speed).toEqual([88]);
    expect(coolant).toEqual([123]);
  });

  it('reads the adapter voltage', async () => {
    const { elm } = await setup();
    await elm.init();
    expect(await elm.adapterVoltage()).toBeCloseTo(14.4, 1);
  });
});

describe('serial error messages', () => {
  it('keeps just the reason', async () => {
    const { SerialTransport } = await import('./transport');
    const err = await new SerialTransport({ path: '/dev/does-not-exist-9', baudRate: 38400 }).open().catch((e: Error) => e);
    expect((err as Error).message).toBe("Can't open /dev/does-not-exist-9: No such file or directory");
  });
});

describe('no adapter set up', () => {
  it('says so plainly, with an example for every kind of port', async () => {
    const { createTransport, UnsetTransport } = await import('./transport');
    const t = createTransport('  ', 38400);
    expect(t).toBeInstanceOf(UnsetTransport);
    await expect(t.open()).rejects.toThrow(/No OBD-II adapter set up\. Set OBD_PORT in \.env, for example COM5/);
  });
});
