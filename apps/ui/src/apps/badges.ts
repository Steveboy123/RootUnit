import { useMemo } from 'react';
import { formatFmFrequency, type ServiceMap, type VehicleState } from '@headunit/shared';
import type { Tone } from '../components/ui';
import { useHeadUnit, useSvc } from '../store';
import type { AppBadge } from './registry';

/** Everything the badges are made from. Each part is undefined until the server has sent it. */
export interface BadgeInput {
  garage?: ServiceMap['garage'];
  health?: ServiceMap['health'];
  dashcam?: ServiceMap['dashcam'];
  fm?: ServiceMap['fm'];
  timers?: ServiceMap['timers'];
  trips?: ServiceMap['trips'];
  gps?: ServiceMap['gps'];
  mil?: VehicleState['mil'];
}

/**
 * The FM transmitter: "On 100.6" while it is on the air, "Check" when it was switched on and is not working (it keeps trying, so it
 * is worth a look). Written against whatever arrived, because the rail asks on every change of the state.
 */
export function fmBadge(fm: ServiceMap['fm'] | undefined): AppBadge {
  if (typeof fm !== 'object' || fm === null) return null;
  if (fm.status === 'transmitting') return { text: typeof fm.frequency === 'number' && Number.isFinite(fm.frequency) ? `On ${formatFmFrequency(fm.frequency)}` : 'On', tone: 'ok' };
  if (fm.on === true && (fm.status === 'error' || fm.status === 'unreachable' || fm.status === 'unsupported' || fm.status === 'unconfigured')) return { text: 'Check', tone: 'warn' };
  return null;
}

/** The small markers on the launcher tiles: what deserves a glance without opening the app. Pure, so the rail can ask the same question. */
export function appBadges({ garage, health, dashcam, fm, timers, trips, gps, mil }: BadgeInput): Record<string, AppBadge> {
  const out: Record<string, AppBadge> = {};

  const overdue = garage?.due.filter((d) => d.status === 'overdue').length ?? 0;
  const soon = garage?.due.filter((d) => d.status === 'soon').length ?? 0;
  if (overdue) out.garage = { text: `${overdue} overdue`, tone: 'danger' };
  else if (soon) out.garage = { text: `${soon} due soon`, tone: 'warn' };

  const t = health?.throttle;
  if (health?.available) {
    if (t?.underVoltageNow) out.system = { text: 'Low power', tone: 'danger' };
    else if (t?.throttledNow || (health.cpuTempC ?? 0) >= 80) out.system = { text: 'Hot', tone: 'warn' };
    else if (t?.underVoltageSince) out.system = { text: 'Had low power', tone: 'warn' };
  }

  if (dashcam?.recording) out.dashcam = { text: 'Recording', tone: 'danger' };
  const fmMarker = fmBadge(fm);
  if (fmMarker) out.fm = fmMarker;
  const running = timers?.items.length ?? 0;
  if (running) out.timers = { text: `${running} running`, tone: 'ok' };
  if (trips?.active) out.trips = { text: 'Recording', tone: 'ok' };
  if (gps?.connected && !gps.fix) out.gps = { text: 'No fix', tone: 'warn' };
  if (mil?.on) out.vehicle = { text: `${mil.count} fault${mil.count === 1 ? '' : 's'}`, tone: 'warn' };
  return out;
}

export function useAppBadges(): Record<string, AppBadge> {
  const garage = useSvc('garage');
  const health = useSvc('health');
  const dashcam = useSvc('dashcam');
  const fm = useSvc('fm');
  const timers = useSvc('timers');
  const trips = useSvc('trips');
  const gps = useSvc('gps');
  const mil = useHeadUnit((s) => s.vehicle?.mil);
  const badges = appBadges({ garage, health, dashcam, fm, timers, trips, gps, mil });
  // The services tick (the GPS several times a second) but the badges almost never change: hand back the same object while they read the
  // same, so the launcher and its tiles are not drawn again for nothing.
  const key = JSON.stringify(badges);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the badges' content
  return useMemo(() => badges, [key]);
}

/** Does this badge ask for a look (a warning or a fault), as opposed to just reporting something (2 running, recording)? */
export const needsAttention = (badge: AppBadge | undefined): boolean => badge !== null && badge !== undefined && (badge.tone === 'warn' || badge.tone === 'danger');

/** The apps that need attention, as `id:tone` pairs in one short string: a component that subscribes to it ignores every other change. */
export function attentionKey(badges: Record<string, AppBadge>): string {
  return Object.keys(badges)
    .filter((id) => needsAttention(badges[id]))
    .sort()
    .map((id) => `${id}:${badges[id]!.tone}`)
    .join(',');
}

const TONES: readonly Tone[] = ['ok', 'warn', 'danger', 'info'];
/** The inverse of attentionKey, as a Map (an app id is never used as an object key). Anything that is not an `id:tone` pair is skipped. */
export function attentionFromKey(key: string): ReadonlyMap<string, { tone: Tone }> {
  const out = new Map<string, { tone: Tone }>();
  for (const pair of key.split(',')) {
    const [id, tone] = pair.split(':');
    if (id && TONES.includes(tone as Tone)) out.set(id, { tone: tone as Tone });
  }
  return out;
}

/**
 * Which apps need attention right now, for the dots on the navigation rail. It subscribes to a single string, never to the live
 * speed or position: the rail does not draw again every time the GPS moves, only when an app starts or stops needing attention.
 */
export function useAttentionBadges(): ReadonlyMap<string, { tone: Tone }> {
  const key = useHeadUnit((s) => attentionKey(appBadges({ garage: s.svc.garage, health: s.svc.health, dashcam: s.svc.dashcam, fm: s.svc.fm, timers: s.svc.timers, trips: s.svc.trips, gps: s.svc.gps, mil: s.vehicle?.mil })));
  return useMemo(() => attentionFromKey(key), [key]);
}
