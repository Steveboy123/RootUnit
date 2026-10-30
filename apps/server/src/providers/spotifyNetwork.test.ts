import { describe, expect, it } from 'vitest';
import { networkCodes, retryableSpotifyConnection, spotifyNetworkFailure, oauthNetworkFailure } from './spotifyNetwork';

describe('Spotify networking failure explanations', () => {
  const wrapped = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('private token text must not leak'), { code }) });
  it('decodes nested Node fetch errors and does not leak internal messages', () => {
    const error = wrapped('EAI_AGAIN');
    expect(networkCodes(error)).toEqual(['EAI_AGAIN']);
    expect(spotifyNetworkFailure(error)).toMatch(/DNS/i);
    expect(spotifyNetworkFailure(error)).not.toContain('private token');
    expect(retryableSpotifyConnection(error)).toBe(true);
  });
  it('distinguishes unreachable IPv6 route, connect timeout, and TLS failure', () => {
    expect(spotifyNetworkFailure(wrapped('ENETUNREACH'))).toMatch(/route.*IPv6/i);
    expect(spotifyNetworkFailure(wrapped('UND_ERR_CONNECT_TIMEOUT'))).toMatch(/timed out/i);
    expect(spotifyNetworkFailure(wrapped('CERT_HAS_EXPIRED'))).toMatch(/certificate/i);
    expect(retryableSpotifyConnection(wrapped('CERT_HAS_EXPIRED'))).toBe(false);
  });
  it('can unwrap aggregate failures without including arbitrary values', () => {
    const e = Object.assign(new TypeError('fetch failed'), {
      cause: { errors: [{ code: 'ENETUNREACH' }, { code: 'ETIMEDOUT' }] },
    });
    expect(networkCodes(e)).toEqual(['ENETUNREACH', 'ETIMEDOUT']);
    expect(spotifyNetworkFailure(e)).toMatch(/route/i);
  });
  it('diagnoses TIDAL TLS/DNS failures without credentials', () => {
    expect(oauthNetworkFailure('TIDAL', wrapped('EAI_AGAIN'))).toMatch(/TIDAL.*DNS/i);
    expect(oauthNetworkFailure('TIDAL', wrapped('CERT_HAS_EXPIRED'))).toMatch(/TIDAL.*certificate/i);
  });
  it('keeps generic fallback for a plain network exception', () => {
    expect(spotifyNetworkFailure(new TypeError('fetch failed'))).toMatch(/Couldn't reach Spotify/);
    expect(retryableSpotifyConnection(new TypeError('fetch failed'))).toBe(false);
  });
});
