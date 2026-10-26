import { describe, expect, it } from 'vitest';
import { appBadges, attentionFromKey, attentionKey, needsAttention } from '../../apps/badges';

// The services arrive over the network; the tests only fill in the fields the badges read.
const garage = (...status: string[]) => ({ due: status.map((s) => ({ status: s })) }) as never;
const health = (over: Record<string, unknown>) => ({ available: true, throttle: {}, cpuTempC: 50, ...over }) as never;

describe('appBadges: what deserves a glance', () => {
  it('nothing, before the server has sent anything', () => {
    expect(appBadges({})).toEqual({});
  });

  it('Garage: overdue is danger and wins over due soon', () => {
    expect(appBadges({ garage: garage('overdue', 'overdue', 'soon', 'ok') }).garage).toEqual({ text: '2 overdue', tone: 'danger' });
    expect(appBadges({ garage: garage('soon', 'ok') }).garage).toEqual({ text: '1 due soon', tone: 'warn' });
    expect(appBadges({ garage: garage('ok') }).garage).toBeUndefined();
  });

  it('System: low power is danger; heat, throttling and a past dip are warnings; a missing sensor says nothing', () => {
    expect(appBadges({ health: health({ throttle: { underVoltageNow: true } }) }).system).toEqual({ text: 'Low power', tone: 'danger' });
    expect(appBadges({ health: health({ cpuTempC: 80 }) }).system).toEqual({ text: 'Hot', tone: 'warn' });
    expect(appBadges({ health: health({ throttle: { throttledNow: true } }) }).system).toEqual({ text: 'Hot', tone: 'warn' });
    expect(appBadges({ health: health({ throttle: { underVoltageSince: true } }) }).system).toEqual({ text: 'Had low power', tone: 'warn' });
    expect(appBadges({ health: health({ available: false, throttle: { underVoltageNow: true } }) }).system).toBeUndefined();
    expect(appBadges({ health: health({}) }).system).toBeUndefined();
  });

  it('Dashcam, Timers, Trips, GPS and Vehicle', () => {
    const b = appBadges({
      dashcam: { recording: true } as never,
      timers: { items: [{}, {}] } as never,
      trips: { active: true } as never,
      gps: { connected: true, fix: false } as never,
      mil: { on: true, count: 1 } as never,
    });
    expect(b).toEqual({
      dashcam: { text: 'Recording', tone: 'danger' },
      timers: { text: '2 running', tone: 'ok' },
      trips: { text: 'Recording', tone: 'ok' },
      gps: { text: 'No fix', tone: 'warn' },
      vehicle: { text: '1 fault', tone: 'warn' },
    });
    expect(appBadges({ mil: { on: true, count: 3 } as never }).vehicle?.text).toBe('3 faults');
    expect(appBadges({ gps: { connected: true, fix: true } as never }).gps).toBeUndefined();
    expect(appBadges({ gps: { connected: false, fix: false } as never }).gps).toBeUndefined();
  });
});

describe('what needs attention', () => {
  it('warnings and faults do; reports (running, recording a trip) and nothing do not', () => {
    expect(needsAttention({ text: 'x', tone: 'danger' })).toBe(true);
    expect(needsAttention({ text: 'x', tone: 'warn' })).toBe(true);
    expect(needsAttention({ text: 'x', tone: 'ok' })).toBe(false);
    expect(needsAttention({ text: 'x', tone: 'info' })).toBe(false);
    expect(needsAttention(null)).toBe(false);
    expect(needsAttention(undefined)).toBe(false);
  });

  it('the key lists only apps that need attention, in a stable order, and reads back the same', () => {
    const badges = appBadges({ garage: garage('overdue'), gps: { connected: true, fix: false } as never, timers: { items: [{}] } as never, trips: { active: true } as never });
    const key = attentionKey(badges);
    expect(key).toBe('garage:danger,gps:warn');
    expect([...attentionFromKey(key)]).toEqual([['garage', { tone: 'danger' }], ['gps', { tone: 'warn' }]]);
    expect(attentionKey({})).toBe('');
    expect(attentionFromKey('').size).toBe(0);
  });

  it('a key with junk in it is read leniently, and an app id is never an object key', () => {
    const map = attentionFromKey('garage:danger,,nothing,gps:purple,:warn,constructor:warn,__proto__:danger');
    expect([...map.keys()]).toEqual(['garage', 'constructor', '__proto__']);
    expect(Object.getPrototypeOf(Object.fromEntries(map))).toBe(Object.prototype); // a Map holds them; nothing leaked into a prototype
    expect(({} as Record<string, unknown>).tone).toBeUndefined();
  });
});
