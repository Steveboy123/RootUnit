import { EDIT_LOCKED_MESSAGE, isEditLocked } from '../driving';
import { appById, type AppDef } from '../../apps/registry';
import { useHeadUnit } from '../../store';
import type { NavPlace, ResolvedNavItem } from './types';

/** Open an app the way the launcher does: a few "apps" are really pages (Phones, Vehicle) with a route of their own. */
export function openAppDef(def: Pick<AppDef, 'id' | 'route'>): void {
  const st = useHeadUnit.getState();
  if (def.route) st.go(def.route);
  else st.openApp(def.id);
}

/**
 * Is the person already exactly where this item points? Only then does a tap do nothing. A pinned app or music tab is "there" on its own
 * page; a built-in page is "there" on that very page. The grouped highlight is NOT enough: Apps is highlighted inside an app and on the
 * Phones page, and Music on Now playing, and tapping them must still lead out to the launcher and to the music page.
 */
export function isAlreadyThere(item: ResolvedNavItem, place: NavPlace): boolean {
  const to = item.to;
  if (to.kind === 'app') return (place.route === 'app' && place.appId === to.app) || (item.appRoute !== null && place.route === item.appRoute);
  if (to.kind === 'music') return place.route === 'media' && place.musicTab === to.tab;
  if (to.kind === 'route') return place.route === to.route;
  return false;
}

/**
 * Go where a `go` item points. Tapping the page you are already on only closes the Quick Panel: it adds nothing to the Back history.
 * Scenes and actions are not run from here (they need their second tap: see the rail).
 */
export function runTarget(item: ResolvedNavItem): void {
  const st = useHeadUnit.getState();
  if (item.kind !== 'go' || item.state !== 'ok') return;
  if (isAlreadyThere(item, { route: st.route, appId: st.appId, musicTab: st.musicTab })) return st.setQuickPanel(false);
  const to = item.to;
  if (to.kind === 'route') return st.go(to.route);
  if (to.kind === 'app') {
    const def = appById(to.app);
    if (def) openAppDef(def);
    return;
  }
  if (to.kind === 'music') {
    st.setMusicTab(to.tab);
    st.go('media');
  }
}

/**
 * Open the navigation editor, from anywhere: the rail's long-press, Settings, the Quick Panel, an app tile. It is refused while the car is
 * moving (the editor changes the controls under the driver's hand, and has a typing box), with the same rule as every other editor
 * (`isEditLocked`: the live speed, or the last minute of it when the reading drops out, the setting, "I'm a passenger"; a speed that was never known never locks), and while the connection to the head unit is
 * down (the change could not be saved). Returns whether it opened.
 */
export function openNavEditor(tab: 'items' | 'look' = 'items'): boolean {
  const st = useHeadUnit.getState();
  if (isEditLocked()) {
    // The Quick Panel footer already says "Park to edit": a toast there would only cover its buttons.
    if (!st.quickPanel) st.showToast(EDIT_LOCKED_MESSAGE);
    return false;
  }
  if (st.conn !== 'open') {
    st.showToast('Reconnect to the head unit to customise navigation');
    return false;
  }
  st.setNavEditor({ tab });
  return true;
}
