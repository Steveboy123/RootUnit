import type { SystemState } from '@headunit/shared';
import { Observable } from '../observable';
import type { SystemProvider } from '../system/system';

/** Volume, brightness and three sound outputs held in memory, so the UI's controls can be designed without a Pi. Demo mode only. */
export function createSimSystem(): SystemProvider {
  const state = new Observable<SystemState>({
    platform: 'demo (simulated)',
    outputs: [
      { id: 1, name: 'Built-in Audio', isDefault: true },
      { id: 2, name: 'RCA Audio HAT', isDefault: false },
      { id: 3, name: 'HDMI / DisplayPort', isDefault: false },
    ],
    volume: 55,
    muted: false,
    brightness: 100,
    // No real backlight: the UI dims itself in software, which is also how a USB/HDMI panel behaves.
    hardwareBrightness: false,
  });

  return {
    state,
    async start() {},
    async apply(patch) {
      const { output, ...rest } = patch;
      const cur = state.get();
      const outputs =
        output !== undefined && cur.outputs.some((o) => o.id === output)
          ? cur.outputs.map((o) => ({ ...o, isDefault: o.id === output }))
          : cur.outputs;
      state.set({ ...cur, ...rest, outputs });
    },
  };
}
