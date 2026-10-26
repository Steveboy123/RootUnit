import { describe, expect, it } from 'vitest';
import { hostnameOf, isAllowedHost, isAllowedOrigin } from './security';

describe('security', () => {
  it('extracts hostnames', () => {
    expect(hostnameOf('127.0.0.1:8787')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:8787')).toBe('::1');
    expect(hostnameOf('LocalHost')).toBe('localhost');
  });

  it('allows loopback hosts only (blocks DNS rebinding)', () => {
    expect(isAllowedHost('localhost:8787')).toBe(true);
    expect(isAllowedHost('127.0.0.1:5173')).toBe(true);
    expect(isAllowedHost('evil.example.com')).toBe(false);
    expect(isAllowedHost('127.0.0.1.evil.com')).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });

  it('honours the extra allow-list', () => {
    expect(isAllowedHost('car.local:8787', ['car.local'])).toBe(true);
    expect(isAllowedHost('car.local:8787')).toBe(false);
  });

  it('blocks cross-site origins but allows missing ones', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:8787')).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('not a url')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
});
