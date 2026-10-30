import { describe, expect, it } from 'vitest';
import { describeWeather, drivingHazard, weatherIcon } from './weather';

describe('describeWeather', () => {
  it.each([
    [0, 'Clear', 'clear'],
    [2, 'Partly cloudy', 'partly'],
    [3, 'Overcast', 'cloud'],
    [45, 'Fog', 'fog'],
    [53, 'Drizzle', 'drizzle'],
    [57, 'Freezing drizzle', 'drizzle'],
    [61, 'Rain', 'rain'],
    [65, 'Heavy rain', 'rain'],
    [67, 'Freezing rain', 'rain'],
    [73, 'Snow', 'snow'],
    [75, 'Heavy snow', 'snow'],
    [81, 'Showers', 'rain'],
    [86, 'Snow showers', 'snow'],
    [95, 'Thunderstorm', 'storm'],
    [99, 'Thunderstorm with hail', 'storm'],
    [1234, 'Unknown', 'cloud'],
  ])('code %i is %s', (code, label, kind) => expect(describeWeather(code)).toEqual({ label, kind }));
});

describe('weatherIcon', () => {
  it('draws a moon for a clear night and the sun for a clear day', () => {
    expect(weatherIcon(0, true)).not.toBe(weatherIcon(0, false));
    expect(weatherIcon(2, true)).not.toBe(weatherIcon(2, false));
  });
  it('rain looks the same day or night', () => {
    expect(weatherIcon(61, true)).toBe(weatherIcon(61, false));
  });
});

describe('drivingHazard', () => {
  it('warns about what matters on the road, and about nothing else', () => {
    for (const code of [45, 56, 66, 65, 75, 95, 99]) expect(drivingHazard(code), String(code)).toBeTruthy();
    for (const code of [0, 1, 2, 3, 51, 61, 71, 80]) expect(drivingHazard(code), String(code)).toBeNull();
  });
});
