import { describe, expect, it } from 'vitest';
import {
  FM_BAND,
  FM_BANDWIDTH_MAX_KHZ,
  FM_DEFAULT_FREQUENCY,
  FM_MAX_PRESETS,
  FM_NOTICE_POINTS,
  FM_PROTOCOL,
  NO_FM,
  SERVICE_NAMES,
  formatFmFrequency,
  normalizeFmFrequency,
  parseFmNodeStatus,
  sanitizeFmPresets,
  stepFmFrequency,
} from '@headunit/shared';

describe('FM frequencies', () => {
  it('rounds to a tenth and accepts the whole band, ends included', () => {
    expect(normalizeFmFrequency(100.64)).toBe(100.6);
    expect(normalizeFmFrequency(100.66)).toBe(100.7);
    expect(normalizeFmFrequency(87.5)).toBe(87.5);
    expect(normalizeFmFrequency(108)).toBe(108);
    expect(normalizeFmFrequency(88.1)).toBe(88.1);
  });

  it('refuses anything outside the band, and anything that is not a finite number', () => {
    for (const bad of [87.4, 87.44, 108.1, 0, -1, 1e9, NaN, Infinity, -Infinity, '100.6', null, undefined, {}, [], true]) expect(normalizeFmFrequency(bad), String(bad)).toBeNull();
  });

  it('honours the limits it is given (a helper may allow less)', () => {
    expect(normalizeFmFrequency(90, { min: 88, max: 92 })).toBe(90);
    expect(normalizeFmFrequency(87.9, { min: 88, max: 92 })).toBeNull();
    expect(normalizeFmFrequency(92.1, { min: 88, max: 92 })).toBeNull();
  });

  it('steps in tenths without floating point drift, and stops at the ends of the band', () => {
    let f = 100.0;
    for (let i = 0; i < 7; i++) f = stepFmFrequency(f, 1);
    expect(f).toBe(100.7);
    for (let i = 0; i < 70; i++) f = stepFmFrequency(f, -1);
    expect(f).toBe(93.7);
    expect(stepFmFrequency(87.5, -1)).toBe(87.5);
    expect(stepFmFrequency(108, 1)).toBe(108);
    expect(stepFmFrequency(100, 10)).toBe(101);
    expect(stepFmFrequency(100, -10)).toBe(99);
    expect(stepFmFrequency(NaN, 0)).toBe(FM_DEFAULT_FREQUENCY);
    expect(stepFmFrequency(95, 100000, { min: 88, max: 92 })).toBe(92);
  });

  it('formats with one decimal', () => {
    expect([formatFmFrequency(100.6), formatFmFrequency(88), formatFmFrequency(108)]).toEqual(['100.6', '88.0', '108.0']);
    expect(formatFmFrequency(NaN)).toBe('--.-');
  });

  it('presets: valid, unique, capped, in the order given, and never throws', () => {
    expect(sanitizeFmPresets([100.6, 88.1, 100.6, 100.64, 'x', 5, null])).toEqual([100.6, 88.1]);
    expect(sanitizeFmPresets(Array.from({ length: 30 }, (_, i) => 88 + i * 0.5))).toHaveLength(FM_MAX_PRESETS);
    for (const junk of [undefined, null, 'a', 1, {}, [[]], Object.create(null)]) expect(sanitizeFmPresets(junk)).toEqual([]);
  });
});

describe('FM service and notice', () => {
  it('fm is one of the named services, and its default state is safe', () => {
    expect(SERVICE_NAMES).toContain('fm');
    expect(NO_FM).toMatchObject({ mode: 'none', status: 'unconfigured', on: false, acknowledged: false, level: 0, demo: false });
    expect(NO_FM.limits).toEqual({ min: FM_BAND.min, max: FM_BAND.max });
    expect(NO_FM.frequency).toBe(FM_DEFAULT_FREQUENCY);
  });

  it('the notice says the things that matter (law, short wire, a free frequency, quality)', () => {
    const text = FM_NOTICE_POINTS.join(' ').toLowerCase();
    for (const word of ['permission', 'amplifier', 'frequency', 'mono']) expect(text).toContain(word);
    expect(FM_NOTICE_POINTS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('parseFmNodeStatus', () => {
  const good = {
    protocol: FM_PROTOCOL,
    version: '1.0.0',
    board: 'Raspberry Pi 4 Model B Rev 1.4',
    supported: true,
    reason: null,
    state: 'transmitting',
    frequency: 100.6,
    bandwidth: 100,
    audio: { connected: true, level: 0.42, underruns: 3 },
    error: null,
    limits: { min: 87.5, max: 108, maxBandwidth: 150 },
    deadmanS: 30,
  };

  it('reads a good answer as it is', () => {
    expect(parseFmNodeStatus(good)).toEqual(good);
  });

  it('is null for anything that is not a helper\'s answer', () => {
    for (const bad of [null, undefined, 'x', 1, [], {}, { protocol: 1 }, { supported: true }, { protocol: 'one', supported: true }, { protocol: NaN, supported: true }]) expect(parseFmNodeStatus(bad)).toBeNull();
  });

  it('cleans what it is given: control characters out, numbers clamped, text cut, an unknown state is idle', () => {
    const r = parseFmNodeStatus({ ...good, state: 'exploding', board: 'Pi\u0000\u001b[31m' + 'x'.repeat(500), frequency: 9999, audio: { connected: 'yes', level: 7, underruns: -4 }, limits: { min: 200, max: -5, maxBandwidth: 9999 }, deadmanS: 0 })!;
    expect(r.state).toBe('idle');
    expect(r.board).not.toMatch(/[\u0000-\u001f]/);
    expect(r.board!.length).toBeLessThanOrEqual(120);
    expect(r.frequency).toBe(120);
    expect(r.audio).toEqual({ connected: false, level: 1, underruns: 0 });
    expect(r.limits.min).toBeLessThanOrEqual(r.limits.max);
    expect(r.limits.maxBandwidth).toBe(FM_BANDWIDTH_MAX_KHZ);
    expect(r.deadmanS).toBe(1);
  });

  it('never throws, whatever shape it is given', () => {
    const evil = { get protocol(): number { throw new Error('boom'); }, supported: true };
    expect(parseFmNodeStatus(evil)).toBeNull(); // JSON has no getters, but the promise holds for objects built in code too
    for (const v of [Object.create(null), new Map(), () => {}, Symbol.iterator, 10n]) expect(() => parseFmNodeStatus(v)).not.toThrow();
  });
});
