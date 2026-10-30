import { describe, expect, it } from 'vitest';
import type { HealthState, ThrottleFlags } from '@headunit/shared';
import { diskTone, healthAlert, loadTone, powerStatus, tempTone, uptimeText } from './health';

const flags = (over: Partial<ThrottleFlags> = {}): ThrottleFlags => ({ raw: 0, underVoltageNow: false, freqCappedNow: false, throttledNow: false, softTempLimitNow: false, underVoltageSince: false, freqCappedSince: false, throttledSince: false, softTempLimitSince: false, ...over });
const health = (over: Partial<HealthState> = {}): HealthState => ({ available: true, model: 'Pi 5', cpuTempC: 55, cpuLoadPct: 10, memUsedPct: 40, memTotalMb: 8000, diskFreeGb: 30, diskTotalGb: 58, uptimeS: 100, throttle: flags(), updatedAt: 1, ...over });

describe('tones', () => {
  it('temperature: fine, getting warm, hot', () => {
    expect(tempTone(60)).toBe('ok');
    expect(tempTone(75)).toBe('warn');
    expect(tempTone(84.9)).toBe('warn');
    expect(tempTone(85)).toBe('danger');
    expect(tempTone(null)).toBeUndefined();
  });
  it('load', () => {
    expect(loadTone(40)).toBe('ok');
    expect(loadTone(80)).toBe('warn');
    expect(loadTone(97)).toBe('danger');
    expect(loadTone(null)).toBeUndefined();
  });
  it('disk: warns on little absolute space or a small share, and says nothing when unknown', () => {
    expect(diskTone(30, 58)).toBe('ok');
    expect(diskTone(1.5, 58)).toBe('warn');
    expect(diskTone(40, 1000)).toBe('warn'); // 4 % of a big disk
    expect(diskTone(0.3, 58)).toBe('danger');
    expect(diskTone(null, 58)).toBeUndefined();
    expect(diskTone(5, 0)).toBeUndefined();
  });
});

describe('powerStatus', () => {
  it('under-voltage now is the loud one, and tells you what to check', () => {
    const p = powerStatus(flags({ underVoltageNow: true, underVoltageSince: true }));
    expect(p.tone).toBe('danger');
    expect(p.detail).toContain('converter');
    expect(p.detail).toContain('5 A');
  });
  it('throttling or a frequency cap now: a warning, and heat gets its own advice', () => {
    expect(powerStatus(flags({ throttledNow: true })).tone).toBe('warn');
    expect(powerStatus(flags({ freqCappedNow: true })).tone).toBe('warn');
    expect(powerStatus(flags({ throttledNow: true, softTempLimitNow: true })).detail).toContain('hot');
  });
  it('a past dip is a warning, a past throttle is only information, nothing at all is "good"', () => {
    expect(powerStatus(flags({ underVoltageSince: true })).tone).toBe('warn');
    expect(powerStatus(flags({ throttledSince: true })).tone).toBe('ok');
    expect(powerStatus(flags()).title).toBe('Power is good');
  });
  it('unreadable flags are not reported as good', () => {
    expect(powerStatus(null).tone).toBe('warn');
  });
  it('every state has a short label that fits a badge, and the loud ones do not say OK', () => {
    const all = [null, flags(), flags({ underVoltageNow: true }), flags({ throttledNow: true }), flags({ underVoltageSince: true }), flags({ throttledSince: true })];
    for (const f of all) {
      const p = powerStatus(f);
      expect(p.short.split(' ').length, p.title).toBeLessThanOrEqual(2);
      expect(p.short.length, p.title).toBeLessThanOrEqual(12);
      if (p.tone !== 'ok') expect(p.short, p.title).not.toMatch(/OK/);
    }
  });
});

describe('healthAlert', () => {
  it('stays quiet when all is well, or when nothing could be read', () => {
    expect(healthAlert(health())).toBeNull();
    expect(healthAlert(undefined)).toBeNull();
    expect(healthAlert(health({ available: false }))).toBeNull();
  });
  it('raises the most serious thing first', () => {
    expect(healthAlert(health({ throttle: flags({ underVoltageNow: true }), cpuTempC: 90 }))).toMatchObject({ id: 'pi-power', level: 'danger' });
    expect(healthAlert(health({ cpuTempC: 90 }))).toMatchObject({ id: 'pi-hot', level: 'danger' });
    expect(healthAlert(health({ diskFreeGb: 0.2 }))).toMatchObject({ id: 'pi-disk', level: 'danger' });
    expect(healthAlert(health({ cpuTempC: 79 }))).toMatchObject({ id: 'pi-warm', level: 'warn' });
    expect(healthAlert(health({ diskFreeGb: 1.2 }))).toMatchObject({ id: 'pi-disk', level: 'warn' });
  });
  it('a dip that already ended is not an alert (it is on the System page)', () => {
    expect(healthAlert(health({ throttle: flags({ underVoltageSince: true }) }))).toBeNull();
  });
});

describe('uptimeText', () => {
  it('reads like a person', () => {
    expect(uptimeText(null)).toBe('—');
    expect(uptimeText(59)).toBe('59 s');
    expect(uptimeText(7300)).toBe('2 h 1 min');
    expect(uptimeText(90061)).toBe('1 d 1 h');
    expect(uptimeText(600)).toBe('10 min');
  });
});
