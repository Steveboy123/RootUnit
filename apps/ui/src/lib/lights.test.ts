import { describe, expect, it } from 'vitest';
import { briToPercent, checkLightsHost, COLOR_PRESETS, listEffects, normalizeHex, percentToBri } from './lights';

describe('brightness', () => {
  it('maps the ends of WLED’s 1-255 scale to 1-100 %', () => {
    expect(briToPercent(255)).toBe(100);
    expect(briToPercent(1)).toBe(1);
    expect(briToPercent(128)).toBe(50);
  });
  it('never reaches zero, which would be the off switch', () => {
    expect(briToPercent(0)).toBe(1);
    expect(percentToBri(0)).toBe(1);
  });
  it('never exceeds the ends', () => {
    expect(percentToBri(150)).toBe(255);
    expect(briToPercent(999)).toBe(100);
  });
  it('round-trips every percent to itself', () => {
    for (let p = 1; p <= 100; p++) expect(briToPercent(percentToBri(p))).toBe(p);
  });
});

describe('normalizeHex', () => {
  it('accepts six digits, with or without #, in any case', () => {
    expect(normalizeHex('#30A5FF')).toBe('#30a5ff');
    expect(normalizeHex('30a5ff')).toBe('#30a5ff');
    expect(normalizeHex('  #30a5ff ')).toBe('#30a5ff');
  });
  it('expands three-digit shorthand', () => expect(normalizeHex('#f80')).toBe('#ff8800'));
  it('refuses anything else', () => {
    for (const bad of ['', '#12', '#12345', '#1234567', '#gggggg', 'red', '#30a5ff;']) expect(normalizeHex(bad), bad).toBeNull();
  });
  it('every preset is a valid colour the server will accept', () => {
    for (const p of COLOR_PRESETS) expect(normalizeHex(p.hex)).toBe(p.hex);
  });
});

describe('checkLightsHost', () => {
  it('lets the address be cleared', () => expect(checkLightsHost('')).toBeNull());
  it('accepts private home networks, at the edges', () => {
    for (const ok of ['192.168.1.50', '10.0.0.2', '172.16.0.9', '172.31.255.254', '10.255.255.254']) expect(checkLightsHost(ok), ok).toBeNull();
  });
  it('refuses public addresses, and the just-outside ranges', () => {
    for (const bad of ['8.8.8.8', '172.15.0.9', '172.32.0.9', '192.169.1.1', '11.0.0.1']) expect(checkLightsHost(bad), bad).toMatch(/private Wi-Fi/);
  });
  it('refuses names, URLs and malformed numbers with an explanation', () => {
    for (const bad of ['wled.local', 'http://192.168.1.5', '192.168.1', '192.168.1.5:80', '192.168.1.256']) expect(checkLightsHost(bad), bad).not.toBeNull();
  });
  it('refuses network and broadcast addresses, as the server does', () => {
    expect(checkLightsHost('192.168.1.0')).not.toBeNull();
    expect(checkLightsHost('192.168.1.255')).not.toBeNull();
  });
});

describe('listEffects', () => {
  const names = ['Solid', 'Blink', 'RSVD', '-', 'Rainbow', '', 'Fire 2012'];
  it('keeps each effect’s own number, even after gaps are dropped', () => {
    expect(listEffects(names)).toEqual([
      { index: 0, name: 'Solid' },
      { index: 1, name: 'Blink' },
      { index: 4, name: 'Rainbow' },
      { index: 6, name: 'Fire 2012' },
    ]);
  });
  it('searches by part of the name, ignoring case and surrounding spaces', () => {
    expect(listEffects(names, '  FIRE ')).toEqual([{ index: 6, name: 'Fire 2012' }]);
    expect(listEffects(names, 'zzz')).toEqual([]);
  });
});
