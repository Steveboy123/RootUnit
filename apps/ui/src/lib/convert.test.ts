import { describe, expect, it } from 'vitest';
import { QUANTITIES, WORLD_CITIES, convertUnit, shownNumber, tipSplit, tripCost, zoneOffsetMinutes } from './convert';

describe('convertUnit', () => {
  it('converts the everyday units both ways', () => {
    expect(convertUnit('length', 100, 'km', 'mi')).toBeCloseTo(62.137, 3);
    expect(convertUnit('length', 1, 'mi', 'km')).toBeCloseTo(1.609344, 6);
    expect(convertUnit('speed', 100, 'kmh', 'mph')).toBeCloseTo(62.137, 3);
    expect(convertUnit('speed', 10, 'ms', 'kmh')).toBeCloseTo(36, 6);
    expect(convertUnit('volume', 1, 'galus', 'l')).toBeCloseTo(3.785, 3);
    expect(convertUnit('mass', 1, 'kg', 'lb')).toBeCloseTo(2.2046, 4);
  });

  it('knows tyre pressures', () => {
    expect(convertUnit('pressure', 2.2, 'bar', 'psi')).toBeCloseTo(31.9, 1);
    expect(convertUnit('pressure', 32, 'psi', 'kpa')).toBeCloseTo(220.6, 1);
  });

  it('converts temperature with its offset', () => {
    expect(convertUnit('temperature', 100, 'c', 'f')).toBe(212);
    expect(convertUnit('temperature', 32, 'f', 'c')).toBe(0);
    expect(convertUnit('temperature', -40, 'c', 'f')).toBe(-40);
  });

  it('turns fuel economy over (L/100 km goes down as mpg goes up)', () => {
    expect(convertUnit('economy', 6, 'l100', 'mpguk')).toBeCloseTo(47.08, 2);
    expect(convertUnit('economy', 6, 'l100', 'mpgus')).toBeCloseTo(39.2, 1);
    expect(convertUnit('economy', 20, 'kml', 'l100')).toBeCloseTo(5, 6);
    const there = convertUnit('economy', 7.3, 'l100', 'mpgus')!;
    expect(convertUnit('economy', there, 'mpgus', 'l100')).toBeCloseTo(7.3, 9);
  });

  it('answers nothing it cannot answer', () => {
    expect(convertUnit('economy', 0, 'mpgus', 'l100')).toBeNull();
    expect(convertUnit('length', 1, 'km', 'parsec')).toBeNull();
    expect(convertUnit('length', Number.NaN, 'km', 'mi')).toBeNull();
  });

  it('every unit listed converts to every other unit of its quantity and back', () => {
    for (const q of QUANTITIES) {
      for (const a of q.units) {
        for (const b of q.units) {
          const there = convertUnit(q.id, 12.5, a.id, b.id);
          expect(there, `${q.id} ${a.id}→${b.id}`).not.toBeNull();
          expect(convertUnit(q.id, there!, b.id, a.id)).toBeCloseTo(12.5, 6);
        }
      }
    }
  });
});

describe('shownNumber', () => {
  it('keeps about four significant figures', () => {
    expect(shownNumber(62.137119)).toMatch(/^62[.,]14$/);
    expect(shownNumber(null)).toBe('—');
    expect(shownNumber(0.000123)).not.toContain('e');
  });
});

describe('tipSplit', () => {
  it('adds the tip and rounds each share up so the bill is covered', () => {
    expect(tipSplit(100, 10, 3)).toEqual({ tip: 10, total: 110, perPerson: 36.67 });
    const s = tipSplit(47.5, 12.5, 4)!;
    expect(s.perPerson * 4).toBeGreaterThanOrEqual(s.total);
  });
  it('treats fewer than one person as one, and refuses a negative bill', () => {
    expect(tipSplit(20, 0, 0)?.perPerson).toBe(20);
    expect(tipSplit(-1, 10, 2)).toBeNull();
  });
});

describe('tripCost', () => {
  it('works out the fuel and its price', () => {
    expect(tripCost(300, 6, 1.8, 2)).toEqual({ litres: 18, cost: 32.4, perPerson: 16.2 });
    expect(tripCost(Number.NaN, 6, 1.8)).toBeNull();
  });
});

describe('world clocks', () => {
  it('knows each listed zone', () => {
    const at = new Date(Date.UTC(2026, 0, 15, 12, 0));
    for (const c of WORLD_CITIES) expect(() => zoneOffsetMinutes(c.zone, at), c.city).not.toThrow();
    expect(zoneOffsetMinutes('Asia/Tokyo', at)).toBe(540);
    expect(zoneOffsetMinutes('Asia/Kolkata', at)).toBe(330);
    expect(zoneOffsetMinutes('America/New_York', at)).toBe(-300);
  });
});
