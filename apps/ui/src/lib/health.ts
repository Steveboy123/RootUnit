import type { HealthState, ThrottleFlags } from '@headunit/shared';
import type { Tone } from '../components/ui';

/** A Raspberry Pi 5 starts to slow itself at 80 C and throttles hard at 85 C; those are the lines worth drawing. */
export function tempTone(c: number | null): Tone | undefined {
  if (c === null) return undefined;
  return c >= 85 ? 'danger' : c >= 75 ? 'warn' : 'ok';
}

export function loadTone(pct: number | null): Tone | undefined {
  if (pct === null) return undefined;
  return pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
}

/** Used share of the disk. A dashcam fills a card without anyone noticing, so this one warns early. */
export function diskTone(freeGb: number | null, totalGb: number | null): Tone | undefined {
  if (freeGb === null || totalGb === null || totalGb <= 0) return undefined;
  if (freeGb < 0.5) return 'danger';
  if (freeGb < 2 || freeGb / totalGb < 0.05) return 'warn';
  return 'ok';
}

export interface PowerStatus {
  tone: Tone;
  title: string;
  /** Two words or fewer, for a badge on a small tile. */
  short: string;
  detail: string;
}

/**
 * What `vcgencmd get_throttled` means for the person fitting the car: under-voltage is the common cause of random freezes and
 * a corrupted SD card, and the cure is almost always the cable or the 12 V to 5 V converter, so the advice says that.
 */
export function powerStatus(t: ThrottleFlags | null): PowerStatus {
  if (!t) return { tone: 'warn', title: 'Power status unavailable', short: 'Unknown', detail: 'The head unit could not read the Pi power flags (vcgencmd).' };
  if (t.underVoltageNow) return { tone: 'danger', title: 'Under-voltage right now', short: 'Low power', detail: 'The Pi is not getting enough power. Check the 12 V to 5 V converter (it must give 5 A for a Pi 5), a short thick USB-C cable and the fuse tap.' };
  if (t.throttledNow || t.freqCappedNow) return { tone: 'warn', title: 'The Pi is slowing itself down', short: 'Slowed down', detail: t.softTempLimitNow ? 'It is too hot. Give it airflow or move it away from the sun and the heater.' : 'It is limiting its speed to protect itself. Check power and cooling.' };
  if (t.underVoltageSince) return { tone: 'warn', title: 'Power dipped since the last start', short: 'Power dipped', detail: 'It is fine now, but the supply sagged at some point. If the screen ever freezes or blanks, this is the first suspect.' };
  if (t.throttledSince || t.freqCappedSince || t.softTempLimitSince) return { tone: 'ok', title: 'Slowed down earlier, fine now', short: 'Power OK', detail: 'It throttled once since start-up (most likely heat) and has recovered.' };
  return { tone: 'ok', title: 'Power is good', short: 'Power OK', detail: 'No under-voltage or throttling since start-up.' };
}

/** The alert text for the banner and the Drive screen: only for what needs the driver or owner to act now. */
export function healthAlert(h: HealthState | undefined): { id: string; level: 'warn' | 'danger'; text: string } | null {
  if (!h?.available) return null;
  const t = h.throttle;
  if (t?.underVoltageNow) return { id: 'pi-power', level: 'danger', text: 'Pi under-voltage: check the power supply (open System)' };
  if ((h.cpuTempC ?? 0) >= 85) return { id: 'pi-hot', level: 'danger', text: `Pi is very hot (${Math.round(h.cpuTempC!)} °C) and slowing down` };
  if (h.diskFreeGb !== null && h.diskFreeGb < 0.5) return { id: 'pi-disk', level: 'danger', text: 'Almost no storage left. Delete dashcam clips (open Dashcam)' };
  if ((h.cpuTempC ?? 0) >= 78) return { id: 'pi-warm', level: 'warn', text: `Pi is running hot (${Math.round(h.cpuTempC!)} °C)` };
  if (h.diskFreeGb !== null && h.diskFreeGb < 2) return { id: 'pi-disk', level: 'warn', text: `Storage is getting low (${h.diskFreeGb.toFixed(1)} GB free)` };
  return null;
}

/** 90061 -> "1 d 1 h", 7300 -> "2 h 2 min", 59 -> "59 s". */
export function uptimeText(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec} s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
