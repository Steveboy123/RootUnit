import { describe, expect, it } from 'vitest';
import { altitudeText, fixQuality, secondsSince } from './gpsInfo';

describe('fixQuality', () => {
  const base = { connected: true, fix: true, accuracyM: 4 };
  it('says so when there is no receiver, before anything about satellites', () => {
    expect(fixQuality({ connected: false, fix: false, accuracyM: null })).toEqual({ label: 'No receiver', tone: 'danger' });
    expect(fixQuality({ connected: false, fix: true, accuracyM: 3 }).label).toBe('No receiver');
  });
  it('says it is searching while there is no fix', () => {
    expect(fixQuality({ ...base, fix: false })).toEqual({ label: 'Searching for satellites', tone: 'warn' });
  });
  it('grades the fix by the receiver’s own error estimate, at the edges', () => {
    expect(fixQuality({ ...base, accuracyM: 5 }).label).toBe('Excellent');
    expect(fixQuality({ ...base, accuracyM: 5.1 }).label).toBe('Good');
    expect(fixQuality({ ...base, accuracyM: 15 }).label).toBe('Good');
    expect(fixQuality({ ...base, accuracyM: 15.1 }).label).toBe('Fair');
    expect(fixQuality({ ...base, accuracyM: 50 }).tone).toBe('warn');
    expect(fixQuality({ ...base, accuracyM: 50.1 })).toEqual({ label: 'Poor', tone: 'warn' });
  });
  it('still reports a fix when the receiver gives no error estimate', () => {
    expect(fixQuality({ ...base, accuracyM: null })).toEqual({ label: 'Position found', tone: 'ok' });
    expect(fixQuality({ ...base, accuracyM: Number.NaN }).label).toBe('Position found');
  });
});

describe('secondsSince', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  it('counts whole seconds', () => expect(secondsSince('2026-06-01T11:59:30Z', now)).toBe(30));
  it('is null for nothing or nonsense', () => {
    expect(secondsSince(null, now)).toBeNull();
    expect(secondsSince('not a date', now)).toBeNull();
  });
  it('never goes negative when the clocks disagree', () => expect(secondsSince('2026-06-01T12:00:05Z', now)).toBe(0));
});

describe('altitudeText', () => {
  it('shows metres or feet', () => {
    expect(altitudeText(100, true)).toBe('100 m');
    expect(altitudeText(100, false)).toBe('328 ft');
  });
  it('shows a dash when the receiver does not know', () => {
    expect(altitudeText(null, true)).toBe('–');
    expect(altitudeText(Number.NaN, false)).toBe('–');
  });
});
