import { describe, expect, it } from 'vitest';
import { pickPlace } from './place';

const loc = { lat: 48.9, lon: 2.3, source: 'saved' as const };

describe('pickPlace', () => {
  it('prefers a live fix', () => {
    expect(pickPlace({ fix: true, latitude: 51.5, longitude: -0.1 }, { location: loc })).toEqual({ lat: 51.5, lon: -0.1 });
  });
  it('falls back to the weather place when there is no fix, even if old coordinates linger', () => {
    expect(pickPlace({ fix: false, latitude: 51.5, longitude: -0.1 }, { location: loc })).toEqual({ lat: 48.9, lon: 2.3 });
  });
  it('is null when nothing is known', () => {
    expect(pickPlace(undefined, undefined)).toBeNull();
    expect(pickPlace({ fix: false, latitude: null, longitude: null }, { location: null })).toBeNull();
  });
  it('treats a fix with no coordinates as no fix', () => {
    expect(pickPlace({ fix: true, latitude: null, longitude: 1 }, { location: null })).toBeNull();
  });
  it('keeps a latitude or longitude of exactly zero (the equator is a place)', () => {
    expect(pickPlace({ fix: true, latitude: 0, longitude: 0 }, undefined)).toEqual({ lat: 0, lon: 0 });
  });
});
