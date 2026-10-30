import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import type { AudioOutput, SystemPatch, SystemState } from '@headunit/shared';
import { Observable } from '../observable';

const run = promisify(execFile);
const BACKLIGHT_DIR = '/sys/class/backlight';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Sound outputs from `pw-dump`: every Audio/Sink node, and which one PipeWire's "default" metadata
 * points at. (pw-dump's JSON is stable; `wpctl status` text is not.)
 */
export function parsePwDump(dump: unknown): AudioOutput[] {
  if (!Array.isArray(dump)) return [];
  const meta = (dump as Json[]).find((o) => o?.type === 'PipeWire:Interface:Metadata' && o?.props?.['metadata.name'] === 'default');
  const entry = (key: string) => (meta?.metadata as Json[] | undefined)?.find((m) => m?.key === key)?.value;
  const nameOf = (v: Json): string | undefined => {
    if (!v) return undefined;
    if (typeof v === 'string') {
      try {
        return nameOf(JSON.parse(v));
      } catch {
        return v;
      }
    }
    return typeof v.name === 'string' ? v.name : undefined;
  };
  const defaultName = nameOf(entry('default.audio.sink')) ?? nameOf(entry('default.configured.audio.sink'));

  const out: AudioOutput[] = [];
  for (const o of dump as Json[]) {
    const props = o?.info?.props;
    if (o?.type !== 'PipeWire:Interface:Node' || props?.['media.class'] !== 'Audio/Sink' || typeof o.id !== 'number') continue;
    const name = String(props['node.description'] ?? props['node.nick'] ?? props['node.name'] ?? `Output ${o.id}`);
    out.push({ id: o.id, name, isDefault: props['node.name'] === defaultName });
  }
  return out;
}

export interface SystemProvider {
  readonly state: Observable<SystemState>;
  apply(patch: SystemPatch): Promise<void>;
  start(): Promise<void>;
}

/**
 * Raspberry Pi OS (Bookworm+): PipeWire via `wpctl`, backlight via `brightnessctl`.
 * Every external call is best-effort — a missing tool degrades, never crashes.
 */
export function createLinuxSystem(): SystemProvider {
  const state = new Observable<SystemState>({
    platform: `linux ${os.release()}`,
    outputs: [],
    volume: 50,
    muted: false,
    brightness: 100,
    hardwareBrightness: false,
  });

  async function readVolume() {
    try {
      const { stdout } = await run('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']);
      const m = /Volume:\s*([\d.]+)/.exec(stdout);
      if (m) state.update({ volume: Math.round(Number(m[1]) * 100), muted: stdout.includes('[MUTED]') });
    } catch {
      /* no PipeWire — keep defaults */
    }
  }

  async function readOutputs() {
    try {
      const { stdout } = await run('pw-dump', [], { maxBuffer: 32 * 1024 * 1024, timeout: 8000 });
      state.update({ outputs: parsePwDump(JSON.parse(stdout)) });
    } catch {
      /* no PipeWire: the picker simply stays hidden */
    }
  }

  async function readBacklight() {
    try {
      const dev = (await readdir(BACKLIGHT_DIR))[0];
      if (!dev) return;
      const cur = Number(await readFile(`${BACKLIGHT_DIR}/${dev}/brightness`, 'utf8'));
      const max = Number(await readFile(`${BACKLIGHT_DIR}/${dev}/max_brightness`, 'utf8'));
      if (max > 0) state.update({ brightness: Math.max(5, Math.round((cur / max) * 100)), hardwareBrightness: true });
    } catch {
      /* HDMI/USB panels have no backlight node — the UI dims in software */
    }
  }

  return {
    state,
    async start() {
      await Promise.all([readVolume(), readOutputs(), readBacklight()]);
    },
    async apply(p) {
      const { output, ...rest } = p;
      if (output !== undefined && state.get().outputs.some((o) => o.id === output)) {
        try {
          await run('wpctl', ['set-default', String(output)]);
          await readOutputs();
          await readVolume(); // a different output has its own volume
        } catch (err) {
          console.warn('[system] switching audio output failed:', (err as Error).message);
        }
      }
      const next = { ...state.get(), ...rest };
      state.set(next);
      try {
        if (p.volume !== undefined) await run('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', (p.volume / 100).toFixed(2)]);
        if (p.muted !== undefined) await run('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', p.muted ? '1' : '0']);
      } catch (err) {
        console.warn('[system] volume control failed:', (err as Error).message);
      }
      if (p.brightness !== undefined && state.get().hardwareBrightness) {
        try {
          await run('brightnessctl', ['set', `${Math.round(p.brightness)}%`]);
        } catch (err) {
          console.warn('[system] brightness control failed, falling back to software dimming:', (err as Error).message);
          state.update({ hardwareBrightness: false });
        }
      }
    },
  };
}

/** Real hardware controls only. Missing PipeWire/backlight tools degrade to unavailable/empty state; no fake values are created. */
export const createSystem = (): SystemProvider => createLinuxSystem();
