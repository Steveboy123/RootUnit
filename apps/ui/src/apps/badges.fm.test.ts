import { describe, expect, it } from 'vitest';
import { NO_FM, type FmState } from '@headunit/shared';
import { appBadges, attentionKey, fmBadge, needsAttention } from './badges';

const fm = (over: Partial<FmState> = {}): FmState => ({ ...NO_FM, mode: 'remote', status: 'idle', acknowledged: true, frequency: 100.6, ...over });

describe('FM transmitter badge', () => {
  it('on the air: "On" and the frequency, in the good colour', () => {
    expect(fmBadge(fm({ status: 'transmitting', on: true }))).toEqual({ text: 'On 100.6', tone: 'ok' });
    expect(fmBadge(fm({ status: 'transmitting', on: true, frequency: 88 }))).toEqual({ text: 'On 88.0', tone: 'ok' });
    // what the head unit reports is what is true, so the badge does not depend on `on`
    expect(fmBadge(fm({ status: 'transmitting', on: false }))?.text).toBe('On 100.6');
  });

  it('on the air with no usable frequency: just "On"', () => {
    for (const frequency of [NaN, Infinity, undefined, null, '100.6']) expect(fmBadge({ ...fm({ status: 'transmitting', on: true }), frequency } as never)).toEqual({ text: 'On', tone: 'ok' });
  });

  it('switched on but failing: "Check", as a warning', () => {
    for (const status of ['error', 'unreachable'] as const) expect(fmBadge(fm({ status, on: true })), status).toEqual({ text: 'Check', tone: 'warn' });
  });

  it('switched on but not possible here (not set up, unsupported Pi): also worth a look', () => {
    for (const status of ['unsupported', 'unconfigured'] as const) expect(fmBadge(fm({ status, on: true })), status).toEqual({ text: 'Check', tone: 'warn' });
  });

  it('nothing when it is off, starting, or merely idle: a failure nobody asked for is not worth a dot', () => {
    for (const status of ['unconfigured', 'unreachable', 'unsupported', 'idle', 'error'] as const) expect(fmBadge(fm({ status, on: false })), status).toBeNull();
    expect(fmBadge(fm({ status: 'idle', on: true }))).toBeNull();
    expect(fmBadge(fm({ status: 'starting', on: true }))).toBeNull();
  });

  it('nothing before the first snapshot, and nothing for a value that is not a state', () => {
    for (const v of [undefined, null, 0, 'x', [], {}, { status: 'melting', on: true }]) expect(fmBadge(v as never), JSON.stringify(v)).toBeNull();
  });
});

describe('FM transmitter badge, in the launcher and the rail', () => {
  it('is the app’s badge under its id, and does not disturb the others', () => {
    expect(appBadges({ fm: fm({ status: 'transmitting', on: true }) }).fm).toEqual({ text: 'On 100.6', tone: 'ok' });
    expect(appBadges({ fm: fm() })).toEqual({});
    expect(appBadges({})).toEqual({});
    const both = appBadges({ fm: fm({ status: 'error', on: true }), dashcam: { recording: true } as never });
    expect(both).toEqual({ dashcam: { text: 'Recording', tone: 'danger' }, fm: { text: 'Check', tone: 'warn' } });
  });

  it('"Check" puts a dot on the rail; "On 100.6" is a report and does not', () => {
    expect(needsAttention(fmBadge(fm({ status: 'error', on: true })) ?? undefined)).toBe(true);
    expect(needsAttention(fmBadge(fm({ status: 'transmitting', on: true })) ?? undefined)).toBe(false);
    expect(attentionKey(appBadges({ fm: fm({ status: 'unreachable', on: true }) }))).toBe('fm:warn');
    expect(attentionKey(appBadges({ fm: fm({ status: 'transmitting', on: true }) }))).toBe('');
  });
});
