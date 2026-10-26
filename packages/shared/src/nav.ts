/**
 * Customisable navigation: what the rail shows and in what order, how the Apps launcher and the Quick Panel are arranged.
 *
 * These are stored in Settings, travel over the same WebSocket as every other setting, and come back from disk and from a restored
 * backup, so EVERYTHING that arrives is untrusted: the sanitizers below build fresh objects from a fixed list of keys, check the
 * type before any pattern test, never index an object by a user string and never throw. Sanitising their own output changes nothing.
 *
 * The vocabularies are append-only: a newer build may add a value (a position, an icon) and an older one simply ignores it.
 */
import { ID_RE } from './features';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const NAV_ROUTES = ['home', 'drive', 'media', 'aa', 'apps', 'settings'] as const;
export type NavRoute = (typeof NAV_ROUTES)[number];

export const NAV_MUSIC_TABS = ['spotify', 'tidal', 'youtube-music', 'radio'] as const;
export type NavMusicTab = (typeof NAV_MUSIC_TABS)[number];

/** Where the navigation sits. A side keeps the most height for the page; the bottom bar suits wide dock styles. Unknown values fall back to the current one. */
export const NAV_POSITIONS = ['left', 'right', 'bottom'] as const;
export type NavPosition = (typeof NAV_POSITIONS)[number];

export const NAV_SIZES = ['compact', 'regular', 'large'] as const;
export type NavSize = (typeof NAV_SIZES)[number];

export const NAV_LABEL_MODES = ['always', 'active', 'never'] as const;
export type NavLabelMode = (typeof NAV_LABEL_MODES)[number];

/** The icons a rail item may use. The screen maps each id to a drawing; an id it does not know is shown as a plain dot. */
export const NAV_ICONS = [
  'home', 'car', 'music', 'radio', 'smartphone', 'grid', 'settings', 'gauge', 'map', 'navigation',
  'camera', 'wrench', 'fuel', 'battery', 'bluetooth', 'wifi', 'phone', 'lightbulb', 'thermometer',
  'clock', 'timer', 'calendar', 'cloud', 'star', 'heart', 'bell', 'lock', 'key', 'shield', 'zap',
  'play', 'mic', 'headphones', 'video', 'notebook', 'flag', 'compass', 'sun', 'moon', 'sliders', 'power', 'sparkles',
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

/**
 * items: everything on the rail, the divider and Settings included.
 * foot: extra buttons that stay pinned beside Settings (they never scroll away).
 * scan: how many entries of an untrusted list are even looked at.
 * label: characters (code points) in a custom label.
 */
export const NAV_LIMITS = { items: 10, foot: 2, scan: 40, label: 10 } as const;
/** The head of the rail (everything before the divider) can hold this many: the cap minus the divider, Settings and the foot. */
const HEAD_AND_FOOT = NAV_LIMITS.items - 2;

/** An app's id as the launcher registry spells it (`gps`, `findcar`, `quick-actions`). */
export const REF_RE = /^[a-z][a-z0-9-]{1,31}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavTarget =
  | { readonly kind: 'route'; readonly route: NavRoute }
  /** Resolved against the app list when drawn: an app that no longer exists is simply not shown. */
  | { readonly kind: 'app'; readonly app: string }
  | { readonly kind: 'music'; readonly tab: NavMusicTab }
  /** Runs when tapped (twice: the first tap arms it). */
  | { readonly kind: 'scene'; readonly scene: string }
  | { readonly kind: 'action'; readonly action: string }
  /** The divider between the scrolling head of the rail and its pinned foot. */
  | { readonly kind: 'gap' };

export interface NavItem {
  /** Unique within the rail. `settings` and `spacer` are reserved for the two fixed entries. */
  readonly id: string;
  readonly to: NavTarget;
  /** Replaces the default name. Absent for the divider and for Settings, whose name and icon are fixed. */
  readonly label?: string;
  readonly icon?: NavIcon;
}

export interface NavConfig {
  readonly version: 1;
  readonly position: NavPosition;
  readonly size: NavSize;
  readonly labels: NavLabelMode;
  /** Always `[...head, divider, ...foot (at most 2), Settings]`. */
  readonly items: readonly NavItem[];
}

/** What a client sends: any of the fields, each replacing the stored one whole. */
export type NavPatch = { readonly version: 1 } & Partial<Omit<NavConfig, 'version'>>;

export interface LauncherConfig {
  readonly version: 1;
  /** App ids hidden from the launcher grid. They stay reachable from a pinned rail item. */
  readonly hidden: readonly string[];
}
export const LAUNCHER_LIMITS = { hidden: 16, scan: 32 } as const;

export const QUICK_TILES = ['camera', 'standby', 'passenger', 'lights', 'aa', 'phones', 'bt'] as const;
export type QuickTile = (typeof QUICK_TILES)[number];

export interface PanelConfig {
  readonly version: 1;
  /** Which tiles the Quick Panel shows and in what order. Sliders, the Display switch and the footer are not configurable. */
  readonly tiles: readonly QuickTile[];
  readonly sections: { readonly scenes: boolean; readonly actions: boolean; readonly sleep: boolean };
}

// ---------------------------------------------------------------------------
// Defaults (deep-frozen: nothing may mutate the shared copy; the sanitizers always return fresh objects)
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const DIVIDER: NavItem = { id: 'spacer', to: { kind: 'gap' } };
const SETTINGS_ITEM: NavItem = { id: 'settings', to: { kind: 'route', route: 'settings' } };

/** Exactly today's rail. */
export const DEFAULT_NAV: NavConfig = deepFreeze({
  version: 1,
  position: 'left',
  size: 'regular',
  labels: 'always',
  items: [
    { id: 'home', to: { kind: 'route', route: 'home' } },
    { id: 'drive', to: { kind: 'route', route: 'drive' } },
    { id: 'music', to: { kind: 'route', route: 'media' } },
    { id: 'auto', to: { kind: 'route', route: 'aa' } },
    { id: 'apps', to: { kind: 'route', route: 'apps' } },
    DIVIDER,
    SETTINGS_ITEM,
  ],
});

export const DEFAULT_LAUNCHER: LauncherConfig = deepFreeze({ version: 1, hidden: [] });

export const DEFAULT_PANEL: PanelConfig = deepFreeze({
  version: 1,
  tiles: [...QUICK_TILES],
  sections: { scenes: true, actions: true, sleep: true },
});

/** Ready-made arrangements. Each is a fixed point of `sanitizeNav` (a test holds that). */
export const NAV_PRESETS = {
  default: DEFAULT_NAV,
  minimal: deepFreeze({
    version: 1,
    position: 'left',
    size: 'regular',
    labels: 'active',
    items: [
      { id: 'home', to: { kind: 'route', route: 'home' } },
      { id: 'music', to: { kind: 'route', route: 'media' } },
      { id: 'auto', to: { kind: 'route', route: 'aa' } },
      DIVIDER,
      SETTINGS_ITEM,
    ],
  } satisfies NavConfig),
  driver: deepFreeze({
    version: 1,
    position: 'left',
    size: 'large',
    labels: 'active',
    items: [
      { id: 'drive', to: { kind: 'route', route: 'drive' } },
      { id: 'music', to: { kind: 'route', route: 'media' } },
      { id: 'auto', to: { kind: 'route', route: 'aa' } },
      DIVIDER,
      SETTINGS_ITEM,
    ],
  } satisfies NavConfig),
} as const;
export type NavPresetId = keyof typeof NAV_PRESETS;

// ---------------------------------------------------------------------------
// Reading untrusted values
// ---------------------------------------------------------------------------

/** A plain `{}` (from JSON or a literal): not an array, not a class instance, not a Map. */
function isPlain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * An OWN DATA property only. Nothing inherited (`constructor`, `__proto__`, `toString`) is ever read as data, and a getter is never run:
 * it reads as "not there". Everything that arrives over the network or from disk is JSON, which has neither; this keeps the promise for
 * objects built in code too, and means a value cannot change between two reads.
 */
function own(o: Record<string, unknown>, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? (d.value as unknown) : undefined;
}

/** `own`, but a property that is not there gives `now` (a patch field that was not sent keeps the stored value). */
function ownOr(o: Record<string, unknown>, key: string, now: unknown): unknown {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? (d.value as unknown) : now;
}

/** The first `max` entries of an untrusted array, read as data (a hole or a getter reads as nothing). The length of a huge or sparse array costs nothing. */
function take(list: readonly unknown[], max: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0, n = Math.min(list.length, max); i < n; i++) {
    const d = Object.getOwnPropertyDescriptor(list, i);
    out.push(d && 'value' in d ? d.value : undefined);
  }
  return out;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

const isId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isRef = (v: unknown): v is string => typeof v === 'string' && REF_RE.test(v);

/** An id for a new rail item: `n` and nine base-36 characters, valid as an item id. Random, so only for the screen that creates it (never for repairing one). */
export function newNavId(): string {
  const bytes = new Uint8Array(9);
  let seeded = false;
  try {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (c?.getRandomValues) {
      c.getRandomValues(bytes);
      seeded = true;
    }
  } catch {
    // an environment without (or with a locked-down) crypto: the fallback below is fine for an id that only has to be unlikely to repeat
  }
  if (!seeded) for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'n' + Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** One key per destination, so the same place cannot be on the rail twice. */
export function targetKey(t: NavTarget): string {
  switch (t.kind) {
    case 'route':
      return `route:${t.route}`;
    case 'app':
      return `app:${t.app}`;
    case 'music':
      return `music:${t.tab}`;
    case 'scene':
      return `scene:${t.scene}`;
    case 'action':
      return `action:${t.action}`;
    case 'gap':
      return 'gap';
  }
}

function sanitizeTarget(raw: unknown): NavTarget | null {
  if (!isPlain(raw)) return null;
  switch (own(raw, 'kind')) {
    case 'route': {
      const route = oneOf(NAV_ROUTES, own(raw, 'route'));
      return route ? { kind: 'route', route } : null;
    }
    case 'app': {
      const app = own(raw, 'app');
      return isRef(app) ? { kind: 'app', app } : null;
    }
    case 'music': {
      const tab = oneOf(NAV_MUSIC_TABS, own(raw, 'tab'));
      return tab ? { kind: 'music', tab } : null;
    }
    case 'scene': {
      const scene = own(raw, 'scene');
      return isId(scene) ? { kind: 'scene', scene } : null;
    }
    case 'action': {
      const action = own(raw, 'action');
      return isId(action) ? { kind: 'action', action } : null;
    }
    case 'gap':
      return { kind: 'gap' };
    default:
      return null;
  }
}

/** How much of a label is even looked at: far more than the characters kept, so invisible padding cannot eat the visible text, yet bounded so a huge string costs nothing. */
const LABEL_SCAN = 200;

/**
 * A label a person can read. In this order: cut to a bounded length; control characters, line separators and characters that draw as
 * nothing (the Hangul fillers, the blank braille cell) become spaces; invisible formatting characters (zero-width and bidi controls, which
 * can hide or reorder text) and a lone half of a surrogate pair are removed; NFC; whitespace collapsed and trimmed; cut to
 * NAV_LIMITS.label code points. The removals come BEFORE the normalisation on purpose: taking a joiner out from between a letter and its
 * accent leaves a pair that NFC would compose, so the other order gives a different answer when the result is cleaned a second time.
 * Nothing left means no label (the default name is used).
 */
export function cleanLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v
    .slice(0, LABEL_SCAN)
    .replace(/[\p{Cc}\u{2028}\u{2029}\u{115f}\u{1160}\u{3164}\u{ffa0}\u{2800}]/gu, ' ')
    .replace(/[\p{Cf}\p{Cs}]/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(s).slice(0, NAV_LIMITS.label).join('').trim();
  return cut === '' ? undefined : cut;
}

// ---------------------------------------------------------------------------
// Sanitizers
//
// All three public pairs have the same shape. The fallback is made whole first (`heal…`: it is trusted to be a valid value already, but a
// caller can hand over anything, such as a stale object or `undefined`), then the work (`read…`) runs inside a try/catch. The work reads only
// own data properties, so on JSON it cannot throw; the catch is for objects built in code (a Proxy, a throwing getter), where "never
// throws" must still hold and the honest answer is the fallback.
// ---------------------------------------------------------------------------

function cloneNav(n: NavConfig): NavConfig {
  return { version: 1, position: n.position, size: n.size, labels: n.labels, items: n.items.map(cloneItem) };
}
function cloneItem(i: NavItem): NavItem {
  const to = sanitizeTarget(i.to) ?? { kind: 'gap' as const };
  return { id: i.id, to, ...(i.label !== undefined ? { label: i.label } : {}), ...(i.icon !== undefined ? { icon: i.icon } : {}) };
}

function healNav(fallback: unknown): NavConfig {
  if (fallback === DEFAULT_NAV) return DEFAULT_NAV;
  try {
    return readNav(fallback, DEFAULT_NAV);
  } catch {
    return DEFAULT_NAV;
  }
}

function readNav(raw: unknown, fb: NavConfig): NavConfig {
  if (!isPlain(raw) || own(raw, 'version') !== 1) return cloneNav(fb);

  const position = oneOf(NAV_POSITIONS, own(raw, 'position')) ?? fb.position;
  const size = oneOf(NAV_SIZES, own(raw, 'size')) ?? fb.size;
  const labels = oneOf(NAV_LABEL_MODES, own(raw, 'labels')) ?? fb.labels;

  const rawItems = own(raw, 'items');
  if (!Array.isArray(rawItems)) return { version: 1, position, size, labels, items: cloneNav(fb).items };

  const scan = take(rawItems, NAV_LIMITS.scan);
  const used = new Set<string>(['settings', 'spacer']);
  const seenTargets = new Set<string>();
  const kept: NavItem[] = [];
  let sawSettings = false;
  let split: number | null = null;
  let repair = 0;

  for (const entry of scan) {
    if (!isPlain(entry)) continue;
    const to = sanitizeTarget(own(entry, 'to'));
    if (!to) continue;
    if (to.kind === 'route' && to.route === 'settings') {
      sawSettings = true;
      continue;
    }
    if (to.kind === 'gap') {
      if (split === null) split = kept.length;
      continue;
    }
    const key = targetKey(to);
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);

    const wanted = own(entry, 'id');
    let id: string;
    if (isId(wanted) && !used.has(wanted)) id = wanted;
    else {
      do id = `item${++repair}`;
      while (used.has(id));
    }
    used.add(id);

    const label = cleanLabel(own(entry, 'label'));
    const icon = oneOf(NAV_ICONS, own(entry, 'icon'));
    kept.push({ id, to, ...(label !== undefined ? { label } : {}), ...(icon ? { icon } : {}) });
  }

  // A list of nothing but junk is damage, not an intention: keep what we had (when loading from disk that is the default rail; for a live
  // patch it is the rail the person has now, so a client that sends something this build cannot read does not wipe a customised rail).
  if (scan.length > 0 && kept.length === 0 && !sawSettings) return { version: 1, position, size, labels, items: cloneNav(fb).items };

  const at = split ?? kept.length;
  const head = kept.slice(0, at);
  let foot = kept.slice(at);
  if (foot.length > NAV_LIMITS.foot) {
    head.push(...foot.slice(NAV_LIMITS.foot));
    foot = foot.slice(0, NAV_LIMITS.foot);
  }
  while (head.length + foot.length > HEAD_AND_FOOT) head.pop();

  return { version: 1, position, size, labels, items: [...head, { id: 'spacer', to: { kind: 'gap' } }, ...foot, { id: 'settings', to: { kind: 'route', route: 'settings' } }] };
}

/**
 * Turn anything into a valid rail. In order: not an object or the wrong version → the fallback; each of position, size and labels is
 * kept if valid; the entries are scanned (at most NAV_LIMITS.scan), each target checked, Settings and the divider set aside, a repeated
 * destination dropped (the first wins), the id kept if it is valid and unused or else repaired deterministically (`item1`, `item2`…),
 * the label cleaned, the icon checked. A list that had entries but kept none (and did not mention Settings) was garbage: the fallback
 * rail comes back (the default when loading, the current rail for a live patch), with the scalars kept. Then head, divider, at most two foot items and Settings are put together within the cap.
 */
export function sanitizeNav(raw: unknown, fallback: NavConfig = DEFAULT_NAV): NavConfig {
  const fb = healNav(fallback);
  try {
    return readNav(raw, fb);
  } catch {
    return cloneNav(fb);
  }
}

const isWholeNav = (v: unknown): boolean => isPlain(v) && own(v, 'version') === 1 && Array.isArray(own(v, 'items'));

/** Apply an untrusted patch to the current rail: an object with `version: 1`, each field present replaces the stored one whole. Anything else is ignored. */
export function applyNavPatch(current: NavConfig, patch: unknown): NavConfig {
  try {
    if (!isPlain(patch) || own(patch, 'version') !== 1) return isWholeNav(current) ? current : healNav(current);
    const base = healNav(current);
    return readNav(
      {
        version: 1,
        position: ownOr(patch, 'position', base.position),
        size: ownOr(patch, 'size', base.size),
        labels: ownOr(patch, 'labels', base.labels),
        items: ownOr(patch, 'items', base.items),
      },
      base,
    );
  } catch {
    return healNav(current);
  }
}

function healLauncher(fallback: unknown): LauncherConfig {
  if (fallback === DEFAULT_LAUNCHER) return DEFAULT_LAUNCHER;
  try {
    return readLauncher(fallback, DEFAULT_LAUNCHER);
  } catch {
    return DEFAULT_LAUNCHER;
  }
}

function readLauncher(raw: unknown, fb: LauncherConfig): LauncherConfig {
  const keep = (): LauncherConfig => ({ version: 1, hidden: [...fb.hidden] });
  if (!isPlain(raw) || own(raw, 'version') !== 1) return keep();
  const hidden = own(raw, 'hidden');
  if (!Array.isArray(hidden)) return keep();
  const out = new Set<string>();
  for (const v of take(hidden, LAUNCHER_LIMITS.scan)) {
    if (isRef(v) && out.size < LAUNCHER_LIMITS.hidden) out.add(v);
  }
  return { version: 1, hidden: [...out] };
}

export function sanitizeLauncher(raw: unknown, fallback: LauncherConfig = DEFAULT_LAUNCHER): LauncherConfig {
  const fb = healLauncher(fallback);
  try {
    return readLauncher(raw, fb);
  } catch {
    return { version: 1, hidden: [...fb.hidden] };
  }
}

const isWholeLauncher = (v: unknown): boolean => isPlain(v) && own(v, 'version') === 1 && Array.isArray(own(v, 'hidden'));

export function applyLauncherPatch(current: LauncherConfig, patch: unknown): LauncherConfig {
  try {
    if (!isPlain(patch) || own(patch, 'version') !== 1) return isWholeLauncher(current) ? current : healLauncher(current);
    const base = healLauncher(current);
    return readLauncher({ version: 1, hidden: ownOr(patch, 'hidden', base.hidden) }, base);
  } catch {
    return healLauncher(current);
  }
}

function healPanel(fallback: unknown): PanelConfig {
  if (fallback === DEFAULT_PANEL) return DEFAULT_PANEL;
  try {
    return readPanel(fallback, DEFAULT_PANEL);
  } catch {
    return DEFAULT_PANEL;
  }
}

function readPanel(raw: unknown, fb: PanelConfig): PanelConfig {
  const base = (): PanelConfig => ({ version: 1, tiles: [...fb.tiles], sections: { ...fb.sections } });
  if (!isPlain(raw) || own(raw, 'version') !== 1) return base();

  let tiles: QuickTile[] = [...fb.tiles];
  const rawTiles = own(raw, 'tiles');
  if (Array.isArray(rawTiles)) {
    const scan = take(rawTiles, QUICK_TILES.length * 2);
    const seen = new Set<QuickTile>();
    for (const v of scan) {
      const t = oneOf(QUICK_TILES, v);
      if (t) seen.add(t);
    }
    // An empty list is a choice (no tiles); a list of nothing but junk is damage, and the fallback's tiles come back (the sections are judged on their own).
    tiles = scan.length > 0 && seen.size === 0 ? [...fb.tiles] : [...seen];
  }

  const sections = { ...fb.sections };
  const rawSections = own(raw, 'sections');
  if (isPlain(rawSections)) {
    for (const key of ['scenes', 'actions', 'sleep'] as const) {
      const v = own(rawSections, key);
      if (typeof v === 'boolean') sections[key] = v;
    }
  }
  return { version: 1, tiles, sections };
}

export function sanitizePanel(raw: unknown, fallback: PanelConfig = DEFAULT_PANEL): PanelConfig {
  const fb = healPanel(fallback);
  try {
    return readPanel(raw, fb);
  } catch {
    return { version: 1, tiles: [...fb.tiles], sections: { ...fb.sections } };
  }
}

const isWholePanel = (v: unknown): boolean => isPlain(v) && own(v, 'version') === 1 && Array.isArray(own(v, 'tiles')) && isPlain(own(v, 'sections'));

export function applyPanelPatch(current: PanelConfig, patch: unknown): PanelConfig {
  try {
    if (!isPlain(patch) || own(patch, 'version') !== 1) return isWholePanel(current) ? current : healPanel(current);
    const base = healPanel(current);
    // `readPanel` takes each section from the patch if it is a boolean and from `base` otherwise: a patch naming one section leaves the others as they were
    return readPanel({ version: 1, tiles: ownOr(patch, 'tiles', base.tiles), sections: ownOr(patch, 'sections', base.sections) }, base);
  } catch {
    return healPanel(current);
  }
}
