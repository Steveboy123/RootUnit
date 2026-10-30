import { describe, expect, it } from 'vitest';
import { createBluezDevices, parseManagedObjects } from './devicesBluez';
import { createSimDevices } from '../demo/devicesSim';

describe('simulated devices', () => {
  const byId = (s: ReturnType<typeof createSimDevices>, id: string) => s.state.get().devices.find((d) => d.id === id)!;

  it('drains a connected phone and charges one on USB', () => {
    const sim = createSimDevices(() => 0.99); // rng high → no signal changes
    const pixel0 = byId(sim, 'sim-pixel').battery!.percent;
    const iphone0 = byId(sim, 'sim-iphone').battery!.percent;
    for (let i = 0; i < 120; i++) sim.tick(1);
    expect(byId(sim, 'sim-pixel').battery!.percent).toBeLessThan(pixel0);
    expect(byId(sim, 'sim-iphone').battery!.percent).toBeGreaterThan(iphone0);
  });

  it('never invents a battery for a phone that is offline', () => {
    const sim = createSimDevices();
    for (let i = 0; i < 50; i++) sim.tick(1);
    expect(byId(sim, 'sim-galaxy').battery).toBeUndefined();
    expect(byId(sim, 'sim-galaxy').connected).toBe(false);
  });

  it('keeps exactly one active phone', async () => {
    const sim = createSimDevices();
    const active = () => sim.state.get().devices.filter((d) => d.active).map((d) => d.id);
    expect(active()).toEqual(['sim-pixel']);
    await sim.command({ cmd: 'activate', id: 'sim-iphone' });
    expect(active()).toEqual(['sim-iphone']);
    await sim.command({ cmd: 'activate', id: 'sim-galaxy' }); // offline → connects first
    expect(active()).toEqual(['sim-galaxy']);
    expect(byId(sim, 'sim-galaxy').connected).toBe(true);
    await sim.command({ cmd: 'disconnect', id: 'sim-galaxy' }); // active leaves → next connected takes over
    expect(active()).toHaveLength(1);
    expect(byId(sim, 'sim-galaxy').connected).toBe(false);
    await sim.command({ cmd: 'activate', id: 'nope' }); // unknown id is ignored
    expect(active()).toHaveLength(1);
  });
});

// busctl --json=short wraps each variant as {"type","data"}; this mirrors that shape.
const v = (type: string, data: unknown) => ({ type, data });
const dev = (props: Record<string, unknown>, battery?: number) => ({
  'org.bluez.Device1': props,
  ...(battery !== undefined ? { 'org.bluez.Battery1': { Percentage: v('y', battery) } } : {}),
});
const FIXTURE = {
  type: 'a{oa{sa{sv}}}',
  data: [
    {
      '/org/bluez': { 'org.bluez.AgentManager1': {} },
      '/org/bluez/hci0': { 'org.bluez.Adapter1': { Powered: v('b', true) } },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_01': dev(
        { Address: v('s', 'AA:BB:CC:DD:EE:01'), Alias: v('s', "Alex's Pixel"), Paired: v('b', true), Connected: v('b', true), Icon: v('s', 'phone'), Modalias: v('s', 'bluetooth:v00E0p1200d0100') },
        77,
      ),
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_02': dev({
        Address: v('s', 'AA:BB:CC:DD:EE:02'), Alias: v('s', 'iPhone'), Paired: v('b', true), Connected: v('b', false), Icon: v('s', 'phone'), Modalias: v('s', 'bluetooth:v004Cp0000d0000'),
      }),
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_03': dev({ Address: v('s', 'AA:BB:CC:DD:EE:03'), Alias: v('s', 'Headphones'), Paired: v('b', true), Connected: v('b', true), Icon: v('s', 'audio-headset') }),
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_04': dev({ Address: v('s', 'AA:BB:CC:DD:EE:04'), Alias: v('s', 'Stranger'), Paired: v('b', false), Connected: v('b', false), Icon: v('s', 'phone') }),
      // No Icon, but the Bluetooth class says "phone" (major class 0x02).
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_05': dev({ Address: v('s', 'AA:BB:CC:DD:EE:05'), Name: v('s', 'Class phone'), Paired: v('b', true), Connected: v('b', false), Class: v('u', 0x5a020c) }),
    },
  ],
};

describe('parseManagedObjects', () => {
  const phones = parseManagedObjects(FIXTURE);

  it('keeps only paired phones; skips headsets and unpaired strangers', () => {
    expect(phones.map((p) => p.name).sort()).toEqual(["Alex's Pixel", 'Class phone', 'iPhone']);
  });
  it('detects Apple by Bluetooth vendor id, everything else phone-like as Android', () => {
    expect(phones.find((p) => p.name === 'iPhone')!.platform).toBe('ios');
    expect(phones.find((p) => p.name === "Alex's Pixel")!.platform).toBe('android');
  });
  it('reads battery only when BlueZ provides it', () => {
    expect(phones.find((p) => p.name === "Alex's Pixel")!.battery).toEqual({ percent: 77 });
    expect(phones.find((p) => p.name === 'iPhone')!.battery).toBeUndefined();
  });
  it('lists connected phones first and reports bluetooth as the transport', () => {
    expect(phones[0]!.name).toBe("Alex's Pixel");
    expect(phones[0]!.transports).toEqual(['bluetooth']);
    expect(phones.find((p) => p.name === 'iPhone')!.transports).toEqual([]);
  });
  it('tolerates empty and garbage input', () => {
    expect(parseManagedObjects(null)).toEqual([]);
    expect(parseManagedObjects({ type: 'x', data: [] })).toEqual([]);
    expect(parseManagedObjects('nope')).toEqual([]);
  });
  it('ignores objects whose path is not a plain device path (no injection into later calls)', () => {
    const evil = { type: 't', data: [{ '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_01; rm -rf /': dev({ Paired: v('b', true), Icon: v('s', 'phone') }) }] };
    expect(parseManagedObjects(evil)).toEqual([]);
  });
});

describe('bluez provider', () => {
  function fake(reply: () => string | Error = () => JSON.stringify(FIXTURE)) {
    const calls: string[][] = [];
    const exec = async (args: string[]) => {
      calls.push(args);
      if (args.includes('GetManagedObjects')) {
        const r = reply();
        if (r instanceof Error) throw r;
        return r;
      }
      return '';
    };
    return { calls, p: createBluezDevices({ exec, bus: 'user' }) };
  }

  it('lists devices with the exact busctl command line and marks the first connected one active', async () => {
    const { p, calls } = fake();
    p.start();
    await new Promise((r) => setTimeout(r, 30));
    p.stop();
    expect(calls[0]).toEqual(['--user', '--json=short', 'call', 'org.bluez', '/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects']);
    const s = p.state.get();
    expect(s.source).toBe('bluez');
    expect(s.devices.find((d) => d.active)?.name).toBe("Alex's Pixel");
  });

  it('activate disconnects the other phone(s), then connects the target', async () => {
    const { p, calls } = fake();
    p.start();
    await new Promise((r) => setTimeout(r, 30));
    p.stop();
    calls.length = 0;
    await p.command({ cmd: 'activate', id: 'AA:BB:CC:DD:EE:02' });
    const verbs = calls.filter((c) => c.includes('org.bluez.Device1')).map((c) => `${c[3]!.split('/').pop()}:${c[5]}`);
    expect(verbs).toEqual(['dev_AA_BB_CC_DD_EE_01:Disconnect', 'dev_AA_BB_CC_DD_EE_02:Connect']);
  });

  it('reports a clear error (not a crash) when Bluetooth is unavailable', async () => {
    const { p } = fake(() => new Error('Failed to connect to bus: No such file or directory'));
    p.start();
    await new Promise((r) => setTimeout(r, 30));
    p.stop();
    expect(p.state.get().devices).toEqual([]);
    expect(p.state.get().error).toMatch(/Bluetooth unavailable/);
  });

  it('refuses commands for unknown devices', async () => {
    const { p, calls } = fake();
    p.start();
    await new Promise((r) => setTimeout(r, 30));
    p.stop();
    calls.length = 0;
    await p.command({ cmd: 'connect', id: 'FF:FF:FF:FF:FF:FF' });
    expect(calls.filter((c) => c.includes('Connect'))).toHaveLength(0);
    expect(p.state.get().error).toMatch(/Unknown device/);
  });
});
