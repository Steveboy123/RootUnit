import { describe, expect, it } from 'vitest';
import { bearingAndDistance, celsiusToDisplay, compassPoint, displayToKm, displayToLiters, economyToDisplay, economyUnit, gallonKind, humanDuration, kmToDisplay, litersToDisplay, shortDistance, volumeUnit } from './units';

describe('distance, volume, temperature', () => {
  it('metric is unchanged; imperial converts and round-trips', () => {
    expect(kmToDisplay(100, 'metric')).toBe(100);
    expect(kmToDisplay(100, 'imperial')).toBeCloseTo(62.137, 2);
    expect(displayToKm(kmToDisplay(123.4, 'imperial'), 'imperial')).toBeCloseTo(123.4, 9);
    expect(litersToDisplay(10, 'imperial', 'us')).toBeCloseTo(2.642, 2);
    expect(litersToDisplay(10, 'imperial', 'uk')).toBeCloseTo(2.2, 2);
    expect(displayToLiters(litersToDisplay(37.5, 'imperial', 'uk'), 'imperial', 'uk')).toBeCloseTo(37.5, 9);
    expect(celsiusToDisplay(100, 'imperial')).toBe(212);
    expect(celsiusToDisplay(-40, 'imperial')).toBe(-40);
  });

  it('picks the gallon from the language region', () => {
    expect(gallonKind('en-GB')).toBe('uk');
    expect(gallonKind('en-AU')).toBe('uk');
    expect(gallonKind('en-US')).toBe('us');
    expect(gallonKind('de-DE')).toBe('us');
    expect(volumeUnit('imperial', 'uk')).toBe('UK gal');
    expect(volumeUnit('metric')).toBe('L');
  });
});

describe('fuel economy', () => {
  it('leaves L/100 km alone in metric', () => {
    expect(economyToDisplay(7.5, 'metric')).toBe(7.5);
    expect(economyUnit('metric')).toBe('L/100 km');
  });

  it('turns it into miles per gallon, the right gallon: 8 L/100 km is 29.4 US mpg and 35.3 UK mpg', () => {
    expect(economyToDisplay(8, 'imperial', 'us')).toBeCloseTo(29.4, 1);
    expect(economyToDisplay(8, 'imperial', 'uk')).toBeCloseTo(35.3, 1);
    expect(economyUnit('imperial', 'us')).toBe('mpg (US)');
    expect(economyUnit('imperial', 'uk')).toBe('mpg (UK)');
  });

  it('has no economy for zero or nonsense', () => {
    expect(economyToDisplay(0, 'imperial')).toBeNull();
    expect(economyToDisplay(-3, 'metric')).toBeNull();
    expect(economyToDisplay(Number.NaN, 'metric')).toBeNull();
  });
});

describe('text helpers', () => {
  it('reads durations like a person', () => {
    expect(humanDuration(45)).toBe('45 s');
    expect(humanDuration(540)).toBe('9 min');
    expect(humanDuration(3725)).toBe('1 h 02 min');
    expect(humanDuration(7199)).toBe('1 h 59 min');
    expect(humanDuration(-5)).toBe('0 s');
  });

  it('names the compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(44)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });

  it('short distances in the right unit', () => {
    expect(shortDistance(0.34, 'metric')).toBe('340 m');
    expect(shortDistance(0.0004, 'metric')).toBe('0 m');
    expect(shortDistance(2.34, 'metric')).toBe('2.3 km');
    expect(shortDistance(25.6, 'metric')).toBe('26 km');
    expect(shortDistance(0.1, 'imperial')).toBe('330 ft');
    expect(shortDistance(5, 'imperial')).toBe('3.1 mi');
  });
});

describe('bearingAndDistance', () => {
  it('due east, due north and the length of a degree', () => {
    expect(bearingAndDistance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }).bearing).toBeCloseTo(90, 3);
    expect(bearingAndDistance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }).bearing).toBeCloseTo(0, 3);
    expect(bearingAndDistance({ lat: 0, lon: 0 }, { lat: 0, lon: -1 }).bearing).toBeCloseTo(270, 3);
    expect(bearingAndDistance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }).km).toBeCloseTo(111.19, 1);
  });
  it('London to Paris: about 344 km, heading south-east', () => {
    const r = bearingAndDistance({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
    expect(r.km).toBeGreaterThan(340);
    expect(r.km).toBeLessThan(348);
    expect(r.bearing).toBeGreaterThan(145);
    expect(r.bearing).toBeLessThan(160);
  });
});
