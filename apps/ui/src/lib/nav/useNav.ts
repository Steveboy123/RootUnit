import { useMemo } from 'react';
import { DEFAULT_NAV, type NavConfig } from '@headunit/shared';
import { APPS } from '../../apps/registry';
import { useHeadUnit, type Route } from '../../store';
import { matchNav, resolveNav } from './resolve';
import type { NavPlace, ResolvedNavItem } from './types';

/** Which rail button a page belongs under: an app, the phones page or the vehicle page all live under Apps; the full-screen player under Music. */
export function railFor(route: Route): Route {
  if (route === 'app' || route === 'devices' || route === 'vehicle') return 'apps';
  if (route === 'nowplaying') return 'media';
  return route;
}

/**
 * Should the top bar show Back? Two reasons, either is enough:
 *  1. the page is one the rail groups under another button (an app under Apps, the player under Music): Back returns to the group;
 *  2. the rail the person has built has no button for this page at all (they removed Apps, say): the rail cannot take them back, Back can.
 * Home never shows it. `items` may include missing entries: a button that is not drawn does not count as a way back.
 */
export function showBack(place: NavPlace, items: readonly ResolvedNavItem[]): boolean {
  if (place.route === 'home') return false;
  if (railFor(place.route) !== place.route) return true;
  return matchNav(items, place) === null;
}

/** The rail being edited while the editor is open (it shows at once), otherwise the saved one. */
export function useNavConfig(): NavConfig {
  return useHeadUnit((s) => s.navDraft ?? s.settings?.nav ?? DEFAULT_NAV);
}

/**
 * The rail's items with their targets looked up. Only primitive and list selectors (never the live speed), so the rail does not draw
 * again every time the GPS moves. Missing entries are included: the rail leaves them out, the editor lists them.
 */
export function useResolvedNav(): ResolvedNavItem[] {
  const config = useNavConfig();
  const scenes = useHeadUnit((s) => s.svc.scenes);
  const actions = useHeadUnit((s) => s.svc.actions);
  return useMemo(() => resolveNav(config, { apps: APPS, scenes, actions }), [config, scenes, actions]);
}

/** The id of the one item that is the current page, or null. */
export function useActiveNavId(items: readonly ResolvedNavItem[]): string | null {
  const route = useHeadUnit((s) => s.route);
  const appId = useHeadUnit((s) => s.appId);
  const musicTab = useHeadUnit((s) => s.musicTab);
  return useMemo(() => matchNav(items, { route, appId, musicTab }), [items, route, appId, musicTab]);
}
