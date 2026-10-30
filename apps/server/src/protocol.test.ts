import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './protocol';

const p = (o: unknown) => parseClientMessage(JSON.stringify(o));

describe('parseClientMessage', () => {
  it('accepts valid media commands', () => {
    expect(p({ t: 'media', command: { cmd: 'toggle' } })).toEqual({ t: 'media', command: { cmd: 'toggle' } });
    expect(p({ t: 'media', command: { cmd: 'seek', positionMs: 1234 } })).toEqual({
      t: 'media',
      command: { cmd: 'seek', positionMs: 1234 },
    });
  });

  it('drops malformed or hostile input', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(p({ t: 'nope' })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'seek', positionMs: 'x' } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'seek', positionMs: null } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'rm -rf' } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'repeat', mode: 'bogus' } })).toBeNull();
    expect(p({ t: 'projection', command: 'reboot' })).toBeNull();
  });

  it('clamps system values', () => {
    expect(p({ t: 'system', patch: { volume: 500, brightness: -3 } })).toEqual({
      t: 'system',
      patch: { volume: 100, brightness: 5 },
    });
    expect(p({ t: 'system', patch: { volume: Infinity } })).toEqual({ t: 'system', patch: {} });
  });

  it('validates device commands', () => {
    expect(p({ t: 'device', command: { cmd: 'activate', id: 'AA:BB:CC:DD:EE:01' } })).toEqual({ t: 'device', command: { cmd: 'activate', id: 'AA:BB:CC:DD:EE:01' } });
    expect(p({ t: 'device', command: { cmd: 'activate', id: 'sim-pixel' } })).not.toBeNull();
    expect(p({ t: 'device', command: { cmd: 'activate', id: 'x; rm -rf /' } })).toBeNull();
    expect(p({ t: 'device', command: { cmd: 'activate', id: 'a'.repeat(65) } })).toBeNull();
    expect(p({ t: 'device', command: { cmd: 'format', id: 'x' } })).toBeNull();
    expect(p({ t: 'device', command: { cmd: 'connect' } })).toBeNull();
  });

  it('validates radio commands', () => {
    expect(p({ t: 'radio', command: { cmd: 'play' } })).toEqual({ t: 'radio', command: { cmd: 'play' } });
    expect(p({ t: 'radio', command: { cmd: 'play', id: 'fip' } })).toEqual({ t: 'radio', command: { cmd: 'play', id: 'fip' } });
    expect(p({ t: 'radio', command: { cmd: 'play', id: 5 } })).toBeNull();
    expect(p({ t: 'radio', command: { cmd: 'favorite', id: 'fip', on: 'yes' } })).toBeNull();
    expect(p({ t: 'radio', command: { cmd: 'favorite', id: 'fip', on: true } })).not.toBeNull();
    expect(p({ t: 'radio', command: { cmd: 'add', name: 'X', url: 'https://x.test/s', genre: 'rock', junk: 1 } })).toEqual({
      t: 'radio',
      command: { cmd: 'add', name: 'X', url: 'https://x.test/s', genre: 'rock' },
    });
    expect(p({ t: 'radio', command: { cmd: 'add', name: 'X' } })).toBeNull();
    expect(p({ t: 'radio', command: { cmd: 'add', name: 'X', url: 'u'.repeat(3000) } })).toBeNull();
    expect(p({ t: 'radio', command: { cmd: 'wipe' } })).toBeNull();
  });

  it('validates camera commands', () => {
    expect(p({ t: 'camera', command: 'toggle' })).toEqual({ t: 'camera', command: 'toggle' });
    expect(p({ t: 'camera', command: 'explode' })).toBeNull();
  });

  it('validates the audio-output switch and diagnostics commands', () => {
    expect(p({ t: 'system', patch: { output: 71 } })).toEqual({ t: 'system', patch: { output: 71 } });
    expect(p({ t: 'system', patch: { output: -1 } })).toEqual({ t: 'system', patch: {} });
    expect(p({ t: 'system', patch: { output: 1.5 } })).toEqual({ t: 'system', patch: {} });
    expect(p({ t: 'system', patch: { output: '71; reboot' } })).toEqual({ t: 'system', patch: {} });
    expect(p({ t: 'diagnostics', command: 'read' })).toEqual({ t: 'diagnostics', command: 'read' });
    expect(p({ t: 'diagnostics', command: 'clear' })).toEqual({ t: 'diagnostics', command: 'clear' });
    expect(p({ t: 'diagnostics', command: 'format' })).toBeNull();
  });

  it('validates the library play commands', () => {
    expect(p({ t: 'media', command: { cmd: 'playContext', uri: 'spotify:playlist:x', offset: 3 } })).toEqual({ t: 'media', command: { cmd: 'playContext', uri: 'spotify:playlist:x', offset: 3 } });
    expect(p({ t: 'media', command: { cmd: 'playContext', uri: 'spotify:playlist:x' } })).toEqual({ t: 'media', command: { cmd: 'playContext', uri: 'spotify:playlist:x' } });
    expect(p({ t: 'media', command: { cmd: 'playContext', uri: 'x', offset: -1 } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playContext', uri: 'x', offset: 1.5 } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playContext', uri: 'x', offset: '3' } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playTracks', uris: ['a', 'b'], offset: 1 } })).toEqual({ t: 'media', command: { cmd: 'playTracks', uris: ['a', 'b'], offset: 1 } });
    expect(p({ t: 'media', command: { cmd: 'playTracks', uris: [] } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playTracks', uris: ['a', 5] } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playTracks', uris: Array(101).fill('a') } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'playTracks', uris: 'a' } })).toBeNull();
    expect(p({ t: 'media', command: { cmd: 'queueAdd', uri: 'spotify:track:x' } })).toEqual({ t: 'media', command: { cmd: 'queueAdd', uri: 'spotify:track:x' } });
    expect(p({ t: 'media', command: { cmd: 'queueAdd', uri: 5 } })).toBeNull();
  });
});
