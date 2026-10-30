import { describe, expect, it } from 'vitest';
import { createSpotifyConnectReceiver, disabledReason } from './spotifyConnect';

const receiver = (platform: NodeJS.Platform, enabled = false) =>
  createSpotifyConnectReceiver({ enabled, name: 'RPI Headunit', binary: '/nope', backend: 'alsa', device: 'default', bitrate: 320, normalize: false, dataDir: '/tmp/none', platform });

describe('native Spotify receiver status', () => {
  it('off Linux, says it is Pi-only and what to use instead', () => {
    const s = receiver('win32').state.get();
    expect(s.state).toBe('disabled');
    expect(s.message).toBe(disabledReason('win32'));
    expect(s.message).toMatch(/Raspberry Pi version only.*Browser fallback/);
  });

  it('on a Pi with the receiver switched off, says how it was switched off', () => {
    expect(receiver('linux').state.get().message).toMatch(/SPOTIFY_CONNECT_DISABLED=1/);
  });

  it('keeps the reason after a stop, and says nothing extra when it is on', () => {
    const r = receiver('darwin');
    r.stop();
    expect(r.state.get()).toMatchObject({ state: 'disabled', message: disabledReason('darwin') });
    expect(receiver('linux', true).state.get().message).toBeUndefined();
  });
});
