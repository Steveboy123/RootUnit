import { createReadStream, type ReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import type { HardwareControlEvent } from '@headunit/shared';
import { Observable } from './observable';

const EV_KEY = 0x01;
const KEY_LEFTCTRL = 29;
const KEY_N = 49;
const KEY_LEFTALT = 56;
const KEY_RIGHTALT = 100;
const KEY_RIGHTCTRL = 97;
const KEY_LEFT = 105;
const KEY_RIGHT = 106;
const KEY_NEXTSONG = 163;
const KEY_PLAYPAUSE = 164;
const KEY_PREVIOUSSONG = 165;

interface InputDevice {
  stream: ReadStream;
  pending: Buffer;
  ctrl: boolean;
  alt: boolean;
}

export interface HardwareInputProvider {
  readonly events: Observable<HardwareControlEvent>;
  start(): void;
  stop(): void;
}

/**
 * Reads multimedia / knob hotkeys directly from Linux evdev without grabbing them.
 * This is intentionally additive: the desktop still receives Volume+/Volume-/Mute, so the
 * Amazon knob keeps its normal system-volume behaviour. We only publish next/previous/toggle.
 *
 * Supported knob modes:
 * - Mode 1 long-turn: KEY_PREVIOUSSONG / KEY_NEXTSONG
 * - Mode 2/3/4 press: Ctrl+Alt+N -> play/pause
 * - Mode 2/4 long-turn: Ctrl(+Alt)+Left/Right -> previous/next
 * Chromium also listens for the same keys as a fallback if /dev/input is not readable.
 */
export function createHardwareInput(dir = '/dev/input'): HardwareInputProvider {
  const events = new Observable<HardwareControlEvent>({ action: 'toggle', at: 0 });
  const devices = new Map<string, InputDevice>();
  let running = false;
  let scanTimer: NodeJS.Timeout | null = null;
  // Linux input_event is 24 bytes on arm64/x64 (two 64-bit timeval members), 16 on 32-bit.
  const eventSize = process.arch === 'arm64' || process.arch === 'x64' ? 24 : 16;
  const typeOffset = eventSize === 24 ? 16 : 8;
  const codeOffset = typeOffset + 2;
  const valueOffset = codeOffset + 2;
  let lastAction: HardwareControlEvent['action'] | null = null;
  let lastAt = 0;

  const emit = (action: HardwareControlEvent['action']) => {
    const at = Date.now();
    // Some composite HID knobs expose the same key on two interfaces. Collapse only near-identical duplicates,
    // not real rotary detents.
    if (action === lastAction && at - lastAt < 35) return;
    lastAction = action;
    lastAt = at;
    events.set({ action, at });
  };

  const handle = (d: InputDevice, type: number, code: number, value: number) => {
    if (type !== EV_KEY) return;
    const down = value !== 0;
    if (code === KEY_LEFTCTRL || code === KEY_RIGHTCTRL) {
      d.ctrl = down;
      return;
    }
    if (code === KEY_LEFTALT || code === KEY_RIGHTALT) {
      d.alt = down;
      return;
    }
    if (value !== 1) return; // one event per detent/key press; ignore autorepeat/release

    if (code === KEY_NEXTSONG) return emit('next');
    if (code === KEY_PREVIOUSSONG) return emit('prev');
    if (code === KEY_PLAYPAUSE) return emit('toggle');
    if (d.ctrl && d.alt && code === KEY_N) return emit('toggle');
    if (d.ctrl && code === KEY_RIGHT) return emit('next');
    if (d.ctrl && code === KEY_LEFT) return emit('prev');
  };

  const attach = (path: string) => {
    if (devices.has(path)) return;
    const d: InputDevice = { stream: createReadStream(path), pending: Buffer.alloc(0), ctrl: false, alt: false };
    devices.set(path, d);
    d.stream.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      d.pending = d.pending.length ? Buffer.concat([d.pending, buf]) : buf;
      let off = 0;
      while (d.pending.length - off >= eventSize) {
        const type = d.pending.readUInt16LE(off + typeOffset);
        const code = d.pending.readUInt16LE(off + codeOffset);
        const value = d.pending.readInt32LE(off + valueOffset);
        handle(d, type, code, value);
        off += eventSize;
      }
      d.pending = off ? d.pending.subarray(off) : d.pending;
    });
    const gone = () => {
      devices.delete(path);
      try { d.stream.destroy(); } catch { /* best effort */ }
    };
    d.stream.on('error', gone);
    d.stream.on('close', () => devices.delete(path));
  };

  const scan = async () => {
    if (!running) return;
    try {
      const names = await readdir(dir);
      const wanted = new Set(names.filter((n) => /^event\d+$/.test(n)).map((n) => `${dir}/${n}`));
      for (const path of wanted) attach(path);
      for (const [path, d] of devices) {
        if (!wanted.has(path)) {
          devices.delete(path);
          d.stream.destroy();
        }
      }
    } catch {
      // Missing /dev/input or permissions simply disables hardware-knob integration.
    }
    if (running) {
      scanTimer = setTimeout(scan, 8000);
      scanTimer.unref();
    }
  };

  return {
    events,
    start() {
      if (running) return;
      running = true;
      void scan();
    },
    stop() {
      running = false;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = null;
      for (const d of devices.values()) d.stream.destroy();
      devices.clear();
    },
  };
}
