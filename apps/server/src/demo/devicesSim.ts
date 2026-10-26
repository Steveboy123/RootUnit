import type { DeviceCommand, DevicesState, PhoneDevice } from '@headunit/shared';
import { Observable } from '../observable';
import type { DevicesProvider } from '../providers/devices';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const initial = (): PhoneDevice[] => [
  {
    id: 'sim-pixel',
    name: "Alex's Pixel 8",
    platform: 'android',
    connected: true,
    active: true,
    transports: ['bluetooth', 'wifi'],
    battery: { percent: 78, charging: false },
    signal: 4,
    carrier: 'T-Mobile',
    projection: 'android-auto',
  },
  {
    id: 'sim-iphone',
    name: "Sam's iPhone 15",
    platform: 'ios',
    connected: true,
    active: false,
    transports: ['usb'],
    battery: { percent: 41, charging: true },
    signal: 3,
    carrier: 'Verizon',
    projection: null,
  },
  { id: 'sim-galaxy', name: 'Old Galaxy S9', platform: 'android', connected: false, active: false, transports: [], projection: null },
];

export interface DevicesSim extends DevicesProvider {
  /** Advance the simulation by dt seconds (exposed for tests). */
  tick(dt: number): void;
}

/** Three fake phones whose battery and signal move, so the Devices UI can be designed with no hardware. */
export function createSimDevices(rng: () => number = Math.random): DevicesSim {
  const state = new Observable<DevicesState>({ source: 'sim', devices: initial() });
  let timer: NodeJS.Timeout | null = null;
  let acc = 0;

  const update = (fn: (d: PhoneDevice) => PhoneDevice) => state.set({ ...state.get(), devices: state.get().devices.map(fn) });

  /** Exactly one connected phone is active; if the active one left, promote the next. */
  function normalize() {
    const devices = state.get().devices;
    const connected = devices.filter((d) => d.connected);
    const active = connected.find((d) => d.active) ?? connected[0];
    state.set({ ...state.get(), devices: devices.map((d) => ({ ...d, active: d.id === active?.id })) });
  }

  return {
    state,

    tick(dt) {
      acc += dt;
      if (acc < 1) return;
      const secs = acc;
      acc = 0;
      update((d) => {
        if (!d.connected) return d;
        const next = { ...d };
        if (d.battery) {
          const rate = d.battery.charging ? 1 / 30 : -1 / 45; // % per second
          // Keep the exact value: rounding every tick would swallow a ~0.02 % step and freeze the battery.
          next.battery = { ...d.battery, percent: clamp(d.battery.percent + rate * secs, 1, 100) };
        }
        if (d.signal !== undefined && rng() < 0.03 * secs) next.signal = clamp(d.signal + (rng() < 0.5 ? -1 : 1), 1, 4);
        return next;
      });
    },

    async command(c: DeviceCommand) {
      const dev = state.get().devices.find((d) => d.id === c.id);
      if (!dev) return;
      switch (c.cmd) {
        case 'connect':
        case 'activate':
          update((d) =>
            d.id !== c.id
              ? d
              : {
                  ...d,
                  connected: true,
                  transports: d.transports.length ? d.transports : ['bluetooth'],
                  // A phone only reports these once connected.
                  battery: d.battery ?? { percent: 63, charging: false },
                  signal: d.signal ?? 3,
                  active: c.cmd === 'activate' ? true : d.active,
                },
          );
          if (c.cmd === 'activate') update((d) => ({ ...d, active: d.id === c.id }));
          break;
        case 'disconnect':
          update((d) => (d.id === c.id ? { ...d, connected: false, active: false, transports: [], projection: null } : d));
          break;
      }
      normalize();
    },

    start() {
      if (timer) return;
      timer = setInterval(() => this.tick(1), 1000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
