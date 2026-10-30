/**
 * The pure half of the Quick Panel and Apps launcher customisation: which apps the launcher shows, pinning an app to the rail, hiding
 * one, and the order of the Quick Panel's tiles. No React and no store, so every rule is tested with plain values.
 *
 * Every function is copy-on-write (its input may be frozen: the shared defaults are) and anything that returns a rail, a launcher
 * config or a tile list runs it through the same sanitizer the server uses, so what the screen shows is what the server will keep.
 * When nothing changes, the SAME object comes back, so a caller can tell "no change" from "changed" with `===`.
 */
import { QUICK_TILES, newNavId, sanitizeLauncher, sanitizeNav, type LauncherConfig, type NavConfig, type NavItem, type PanelConfig, type QuickTile } from '@headunit/shared';
import { needsAttention } from '../apps/badges';
import type { AppBadge } from '../apps/registry';

// ---------------------------------------------------------------------------
// Apps launcher
// ---------------------------------------------------------------------------

const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * The apps the launcher draws, in their own order. A hidden app is left out, with one exception: an app that needs a look right now
 * (an overdue service, a hot Pi, no GPS fix: a warning or danger badge) stays, because hiding must never bury a warning. With
 * `showHidden` (the "Hidden (n)" chip is on) everything is drawn, so a hidden app can be reached and shown again.
 */
export function visibleApps<T extends { readonly id: string }>(apps: readonly T[], hidden: readonly string[], badges: Readonly<Record<string, AppBadge>>, showHidden: boolean): T[] {
  if (showHidden) return [...apps];
  const hide = new Set(hidden);
  return apps.filter((a) => !hide.has(a.id) || (has(badges, a.id) && needsAttention(badges[a.id])));
}

/** The apps that are in the hidden list (an id this build has no app for is not one of them: it cannot be shown or un-hidden by name). */
export function hiddenApps<T extends { readonly id: string }>(apps: readonly T[], hidden: readonly string[]): T[] {
  const hide = new Set(hidden);
  return apps.filter((a) => hide.has(a.id));
}

export const isHidden = (launcher: LauncherConfig, appId: string): boolean => launcher.hidden.includes(appId);

/**
 * Hide the app, or show it again if it is hidden. The same launcher comes back when nothing can change: a hidden list that is full
 * (16), or an id that is not a valid app id.
 */
export function toggleHidden(launcher: LauncherConfig, appId: string): LauncherConfig {
  const hidden = isHidden(launcher, appId) ? launcher.hidden.filter((h) => h !== appId) : [...launcher.hidden, appId];
  const next = sanitizeLauncher({ version: 1, hidden }, launcher);
  const same = next.hidden.length === launcher.hidden.length && next.hidden.every((h, i) => h === launcher.hidden[i]);
  return same ? launcher : next;
}

/** Show every app again. */
export const showAllApps = (launcher: LauncherConfig): LauncherConfig => (launcher.hidden.length === 0 ? launcher : sanitizeLauncher({ version: 1, hidden: [] }, launcher));

// ---------------------------------------------------------------------------
// Pinning an app to the rail
// ---------------------------------------------------------------------------

/** Is the app already a button on the rail? */
export const isPinned = (nav: NavConfig, appId: string): boolean => nav.items.some((i) => i.to.kind === 'app' && i.to.app === appId);

/**
 * The rail with the app added as its last scrolling button (just before the divider, so the pinned foot and Settings stay where they
 * are). `null` when the rail has no room: the cap of 10 (divider and Settings included) is reached. The sanitizer enforces the cap by
 * dropping the last head button, which is the new one, so "it is not there afterwards" is exactly "it did not fit". An app that is
 * already pinned gives the same rail back. `id` is only a parameter so a test can name it.
 */
export function pinApp(nav: NavConfig, appId: string, id: string = newNavId()): NavConfig | null {
  if (isPinned(nav, appId)) return nav;
  const gap = nav.items.findIndex((i) => i.to.kind === 'gap');
  const at = gap < 0 ? nav.items.length : gap;
  const item: NavItem = { id, to: { kind: 'app', app: appId } };
  const next = sanitizeNav({ ...nav, items: [...nav.items.slice(0, at), item, ...nav.items.slice(at)] }, nav);
  return isPinned(next, appId) ? next : null;
}

/** The rail without the app. The same rail comes back if it was not pinned. */
export function unpinApp(nav: NavConfig, appId: string): NavConfig {
  if (!isPinned(nav, appId)) return nav;
  return sanitizeNav({ ...nav, items: nav.items.filter((i) => !(i.to.kind === 'app' && i.to.app === appId)) }, nav);
}

/** What "Add to navigation" (or "Remove") in a tile's menu does: the rail to save, or `full` (no room: the screen says so and opens the editor). */
export type PinChange = { kind: 'pin' | 'unpin'; nav: NavConfig } | { kind: 'full' };

export function togglePin(nav: NavConfig, appId: string, id?: string): PinChange {
  if (isPinned(nav, appId)) return { kind: 'unpin', nav: unpinApp(nav, appId) };
  const next = pinApp(nav, appId, id);
  return next ? { kind: 'pin', nav: next } : { kind: 'full' };
}

// ---------------------------------------------------------------------------
// Quick Panel
// ---------------------------------------------------------------------------

/** What each tile is called, in the panel and in Settings. Typed over the whole vocabulary: a tile added to the shared list will not compile until it is named here. */
export const QUICK_TILE_LABELS: Readonly<Record<QuickTile, string>> = {
  camera: 'Rear view',
  standby: 'Standby',
  passenger: 'Passenger',
  lights: 'Cabin lights',
  aa: 'Android Auto',
  phones: 'Phones',
  bt: 'Bluetooth & Wi-Fi',
};

/** The three optional sections under the tiles. */
export const PANEL_SECTIONS: ReadonlyArray<{ key: keyof PanelConfig['sections']; label: string; hint: string }> = [
  { key: 'scenes', label: 'Scenes', hint: 'One-tap looks for the whole car' },
  { key: 'actions', label: 'Quick actions', hint: 'Garage door, lights and your own buttons' },
  { key: 'sleep', label: 'Sleep timer', hint: 'Stops the music after a while' },
];

/** Move a shown tile one place earlier (-1) or later (1). The same list comes back at an end, or for a tile that is not shown. */
export function movePanelTile(tiles: readonly QuickTile[], tile: QuickTile, dir: -1 | 1): readonly QuickTile[] {
  const from = tiles.indexOf(tile);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= tiles.length) return tiles;
  const next = [...tiles];
  next[from] = tiles[to]!;
  next[to] = tile;
  return next;
}

const canonical = (t: QuickTile): number => QUICK_TILES.indexOf(t);

/**
 * Show or hide a tile. Hiding takes it out; showing puts it back where the default order would have it (before the first shown tile
 * that comes after it by default, else last), so hiding a tile and showing it again is a round trip when the order is the default.
 */
export function togglePanelTile(tiles: readonly QuickTile[], tile: QuickTile): readonly QuickTile[] {
  if (tiles.includes(tile)) return tiles.filter((t) => t !== tile);
  const before = tiles.findIndex((t) => canonical(t) > canonical(tile));
  return before < 0 ? [...tiles, tile] : [...tiles.slice(0, before), tile, ...tiles.slice(before)];
}

export interface PanelTileRow {
  tile: QuickTile;
  shown: boolean;
  /** Can move earlier / later among the shown tiles. A tile that is not shown has no place to move. */
  canUp: boolean;
  canDown: boolean;
}

/** The Settings list: the shown tiles in their order, then the hidden ones in the default order. Every tile appears exactly once. */
export function panelTileRows(tiles: readonly QuickTile[]): PanelTileRow[] {
  const shown = tiles.filter((t, i) => QUICK_TILES.includes(t) && tiles.indexOf(t) === i);
  const rows: PanelTileRow[] = shown.map((tile, i) => ({ tile, shown: true, canUp: i > 0, canDown: i < shown.length - 1 }));
  for (const tile of QUICK_TILES) if (!shown.includes(tile)) rows.push({ tile, shown: false, canUp: false, canDown: false });
  return rows;
}
