import { Car, Gauge, House, LayoutGrid, ListMusic, Music2, Radio, Settings, Sparkles, Waves, Zap, type LucideIcon } from 'lucide-react';
import { NAV_ICONS, sanitizeNav, type NavConfig, type NavItem, type NavMusicTab, type NavRoute } from '@headunit/shared';
import { ACTION_GLYPHS, SCENE_GLYPHS } from '../../components/glyphs';
import { navIcon } from './icons';
import type { NavContext, NavPlace, ResolvedNavItem } from './types';

const ROUTE_LABEL: Record<NavRoute, string> = { home: 'Home', drive: 'Drive', media: 'Music', aa: 'Auto', apps: 'Apps', settings: 'Settings' };
const ROUTE_ICON: Record<NavRoute, LucideIcon> = { home: House, drive: Gauge, media: Music2, aa: Car, apps: LayoutGrid, settings: Settings };
const TAB_LABEL: Record<NavMusicTab, string> = { spotify: 'Spotify', tidal: 'TIDAL', 'youtube-music': 'YT Music', radio: 'Radio' };
const TAB_ICON: Record<NavMusicTab, LucideIcon> = { spotify: Music2, tidal: Waves, 'youtube-music': ListMusic, radio: Radio };
const KNOWN_ICON_IDS: ReadonlySet<string> = new Set(NAV_ICONS);

/** A glyph table lookup that cannot be fooled by a key like `constructor` (or by something that is not a string at all). */
const pick = <T,>(table: Record<string, T>, key: unknown): T | undefined => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** The lists come over the network: a list that is not an array counts as not arrived yet, and an entry that is not an object is skipped. */
const asList = <T,>(v: readonly T[] | undefined): readonly T[] | undefined => (Array.isArray(v) ? (v as readonly T[]) : undefined);
const findById = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => list.find((x) => typeof x === 'object' && x !== null && x.id === id);
/** A name from outside: only a non-empty string will do. */
const nameOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Turn the stored rail into what to draw. The stored value is sanitised again first (it came from disk, the network or a backup), and
 * references are looked up in the live lists: an app that is gone is `missing`; a scene or action is `missing` only once the server has
 * sent its list, until then `loading`. Missing items are returned too, so the editor can list them; the rail leaves them out.
 */
export function resolveNav(config: NavConfig, ctx: NavContext): ResolvedNavItem[] {
  return sanitizeNav(config).items.map((item) => resolveItem(item, ctx));
}

function resolveItem(item: NavItem, ctx: NavContext): ResolvedNavItem {
  const to = item.to;
  const customIcon = item.icon && KNOWN_ICON_IDS.has(item.icon) ? item.icon : null;
  const base = { id: item.id, to, customLabel: item.label ?? null, iconId: customIcon, fixed: false, appRoute: null as ResolvedNavItem['appRoute'] };
  const withIcon = (fallback: LucideIcon) => navIcon(customIcon) ?? fallback;
  const label = (fallback: string) => item.label ?? fallback;

  switch (to.kind) {
    case 'gap':
      return { ...base, kind: 'gap', label: '', customLabel: null, iconId: null, Icon: Sparkles, state: 'ok' };
    case 'route':
      if (to.route === 'settings') return { ...base, kind: 'go', label: 'Settings', customLabel: null, iconId: null, Icon: Settings, state: 'ok', fixed: true };
      return { ...base, kind: 'go', label: label(ROUTE_LABEL[to.route]), Icon: withIcon(ROUTE_ICON[to.route]), state: 'ok' };
    case 'music':
      return { ...base, kind: 'go', label: label(TAB_LABEL[to.tab]), Icon: withIcon(TAB_ICON[to.tab]), state: 'ok' };
    case 'app': {
      const def = findById(asList(ctx.apps) ?? [], to.app);
      if (!def) return { ...base, kind: 'go', label: label(to.app), Icon: withIcon(Sparkles), state: 'missing' };
      return { ...base, kind: 'go', label: label(nameOf(def.short) ?? nameOf(def.name) ?? to.app), Icon: withIcon(def.icon ?? Sparkles), state: 'ok', appRoute: def.route ?? null };
    }
    case 'scene': {
      const scenes = asList(ctx.scenes);
      if (scenes === undefined) return { ...base, kind: 'run', label: label('Scene'), Icon: withIcon(Sparkles), state: 'loading' };
      const scene = findById(scenes, to.scene);
      if (!scene) return { ...base, kind: 'run', label: label('Scene'), Icon: withIcon(Sparkles), state: 'missing' };
      return { ...base, kind: 'run', label: label(nameOf(scene.name) ?? 'Scene'), Icon: withIcon(pick(SCENE_GLYPHS, scene.icon) ?? Sparkles), state: 'ok' };
    }
    case 'action': {
      const actions = asList(ctx.actions);
      if (actions === undefined) return { ...base, kind: 'run', label: label('Action'), Icon: withIcon(Zap), state: 'loading' };
      const action = findById(actions, to.action);
      if (!action) return { ...base, kind: 'run', label: label('Action'), Icon: withIcon(Zap), state: 'missing' };
      return { ...base, kind: 'run', label: label(nameOf(action.name) ?? 'Action'), Icon: withIcon(pick(ACTION_GLYPHS, action.icon) ?? Zap), state: 'ok' };
    }
  }
}

/**
 * Which item to highlight: the MOST SPECIFIC match wins. A pinned app or music tab (score 2) beats the grouped built-in it lives under
 * (score 1: Apps, Music, Home...). Ties go to the first item. Scenes, actions and the divider are never active. Missing items are skipped.
 */
export function matchNav(items: readonly ResolvedNavItem[], place: NavPlace): string | null {
  let best: { id: string; score: number } | null = null;
  for (const it of items) {
    if (it.state === 'missing' || it.kind === 'gap') continue;
    const score = scoreItem(it, place);
    if (score > 0 && (!best || score > best.score)) best = { id: it.id, score };
  }
  return best?.id ?? null;
}

function scoreItem(it: ResolvedNavItem, place: NavPlace): number {
  const to = it.to;
  switch (to.kind) {
    case 'app':
      return (place.route === 'app' && place.appId === to.app) || (it.appRoute !== null && place.route === it.appRoute) ? 2 : 0;
    case 'music':
      return place.route === 'media' && place.musicTab === to.tab ? 2 : 0;
    case 'route':
      switch (to.route) {
        case 'home':
          return place.route === 'home' ? 1 : 0;
        case 'drive':
          return place.route === 'drive' ? 1 : 0;
        case 'media':
          return place.route === 'media' || place.route === 'nowplaying' ? 1 : 0;
        case 'aa':
          return place.route === 'aa' ? 1 : 0;
        case 'apps':
          return place.route === 'apps' || place.route === 'app' || place.route === 'devices' || place.route === 'vehicle' ? 1 : 0;
        case 'settings':
          return place.route === 'settings' ? 1 : 0;
      }
      return 0;
    default:
      return 0;
  }
}
