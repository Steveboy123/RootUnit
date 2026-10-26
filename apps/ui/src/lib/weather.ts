import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun, type LucideIcon } from 'lucide-react';

export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather interpretation codes, as Open-Meteo reports them, reduced to what a head unit needs to say and draw. */
export function describeWeather(code: number): { label: string; kind: WeatherKind } {
  if (code === 0) return { label: 'Clear', kind: 'clear' };
  if (code === 1) return { label: 'Mostly clear', kind: 'clear' };
  if (code === 2) return { label: 'Partly cloudy', kind: 'partly' };
  if (code === 3) return { label: 'Overcast', kind: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', kind: 'fog' };
  if (code >= 51 && code <= 57) return { label: code >= 56 ? 'Freezing drizzle' : 'Drizzle', kind: 'drizzle' };
  if (code >= 61 && code <= 67) return { label: code >= 66 ? 'Freezing rain' : code === 65 ? 'Heavy rain' : 'Rain', kind: 'rain' };
  if (code >= 71 && code <= 77) return { label: code === 75 ? 'Heavy snow' : 'Snow', kind: 'snow' };
  if (code >= 80 && code <= 82) return { label: code === 82 ? 'Violent showers' : 'Showers', kind: 'rain' };
  if (code === 85 || code === 86) return { label: 'Snow showers', kind: 'snow' };
  if (code === 95) return { label: 'Thunderstorm', kind: 'storm' };
  if (code === 96 || code === 99) return { label: 'Thunderstorm with hail', kind: 'storm' };
  return { label: 'Unknown', kind: 'cloud' };
}

const DAY: Record<WeatherKind, LucideIcon> = { clear: Sun, partly: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const NIGHT: Record<WeatherKind, LucideIcon> = { ...DAY, clear: Moon, partly: CloudMoon };

export function weatherIcon(code: number, isDay = true): LucideIcon {
  const kind = describeWeather(code).kind;
  return (isDay ? DAY : NIGHT)[kind];
}

/** Is there something a driver should be warned about (ice, heavy rain, storm, fog)? */
export function drivingHazard(code: number): string | null {
  if (code === 45 || code === 48) return 'Fog: slow down and use fog lights';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'Freezing rain: ice on the road';
  if (code === 65 || code === 82) return 'Heavy rain: leave more room';
  if (code === 75 || code === 86) return 'Heavy snow: take care';
  if (code === 95 || code === 96 || code === 99) return 'Thunderstorm';
  return null;
}
