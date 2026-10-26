import { describe, expect, it } from 'vitest';
import { parsePwDump } from './system';
import { createSimSystem } from '../demo/system';

// Shaped like real `pw-dump` output (an array of PipeWire objects).
const node = (id: number, name: string, description: string, cls = 'Audio/Sink') => ({
  id,
  type: 'PipeWire:Interface:Node',
  info: { props: { 'media.class': cls, 'node.name': name, 'node.description': description } },
});
const metadata = (entries: Array<{ key: string; value: unknown }>) => ({
  id: 33,
  type: 'PipeWire:Interface:Metadata',
  props: { 'metadata.name': 'default' },
  metadata: entries.map((e) => ({ subject: 0, type: 'Spa:String:JSON', ...e })),
});

const DUMP = [
  { id: 0, type: 'PipeWire:Interface:Core' },
  node(52, 'alsa_output.platform-soc_sound.stereo-fallback', 'Built-in Audio Stereo'),
  node(60, 'alsa_output.platform-soc_107c701400.hdmi.hdmi-stereo', 'HDMI / DisplayPort'),
  node(71, 'alsa_output.platform-soc_sound.pro-output-0', 'RPi DAC Pro (RCA)'),
  node(80, 'alsa_input.usb-mic', 'USB Mic', 'Audio/Source'),
  node(90, 'some.video', 'Camera', 'Video/Source'),
  metadata([{ key: 'default.audio.sink', value: { name: 'alsa_output.platform-soc_sound.pro-output-0' } }]),
];

describe('parsePwDump', () => {
  it('lists only audio sinks and marks the default', () => {
    expect(parsePwDump(DUMP)).toEqual([
      { id: 52, name: 'Built-in Audio Stereo', isDefault: false },
      { id: 60, name: 'HDMI / DisplayPort', isDefault: false },
      { id: 71, name: 'RPi DAC Pro (RCA)', isDefault: true },
    ]);
  });
  it('accepts the default as a JSON string and falls back to the configured default', () => {
    const asString = [...DUMP.slice(0, -1), metadata([{ key: 'default.audio.sink', value: '{"name":"alsa_output.platform-soc_sound.stereo-fallback"}' }])];
    expect(parsePwDump(asString).find((o) => o.isDefault)?.id).toBe(52);
    const configured = [...DUMP.slice(0, -1), metadata([{ key: 'default.configured.audio.sink', value: { name: 'alsa_output.platform-soc_107c701400.hdmi.hdmi-stereo' } }])];
    expect(parsePwDump(configured).find((o) => o.isDefault)?.id).toBe(60);
  });
  it('marks nothing default when there is no metadata, and survives garbage', () => {
    expect(parsePwDump(DUMP.slice(0, -1)).some((o) => o.isDefault)).toBe(false);
    expect(parsePwDump(null)).toEqual([]);
    expect(parsePwDump('x')).toEqual([]);
    expect(parsePwDump([null, 5, { type: 'PipeWire:Interface:Node' }])).toEqual([]);
  });
});

describe('simulated outputs', () => {
  it('switches the default output and ignores unknown ids', async () => {
    const s = createSimSystem();
    expect(s.state.get().outputs.find((o) => o.isDefault)?.id).toBe(1);
    await s.apply({ output: 2 });
    expect(s.state.get().outputs.filter((o) => o.isDefault).map((o) => o.id)).toEqual([2]);
    await s.apply({ output: 999 });
    expect(s.state.get().outputs.filter((o) => o.isDefault).map((o) => o.id)).toEqual([2]);
    await s.apply({ volume: 30 });
    expect(s.state.get().volume).toBe(30);
  });
});
