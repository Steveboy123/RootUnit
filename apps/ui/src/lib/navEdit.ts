/**
 * The navigation editor's brain, with no screen in it: every change to the rail is a function from one valid rail to the next, and the
 * draft that is being edited is saved through a small debounced scheduler. Both are tested without a browser.
 *
 * Every reducer is copy-on-write (its input may be frozen: the saved rail and the defaults are), and every result goes back through
 * `sanitizeNav`, so the rail's rules (Settings last and fixed, one divider, at most 2 pinned buttons, at most 10 entries in all) hold
 * whatever the screen asks for. A change the rules refuse returns the SAME object it was given, so a caller can tell "nothing happened"
 * with `===` (and the screen disables the control that would have asked).
 */
import {
  DEFAULT_NAV,
  NAV_ICONS,
  NAV_LIMITS,
  NAV_PRESETS,
  cleanLabel,
  newNavId,
  sanitizeNav,
  targetKey,
  type NavConfig,
  type NavIcon,
  type NavItem,
  type NavLabelMode,
  type NavPatch,
  type NavPosition,
  type NavPresetId,
  type NavSize,
  type NavTarget,
} from '@headunit/shared';

/** Buttons the rail can hold besides the divider and Settings: the head plus the pinned foot. */
export const MAX_BUTTONS = NAV_LIMITS.items - 2;

const isSettings = (i: NavItem): boolean => i.to.kind === 'route' && i.to.route === 'settings';
const isGap = (i: NavItem): boolean => i.to.kind === 'gap';

// ---------------------------------------------------------------------------
// Reading the rail
// ---------------------------------------------------------------------------

export interface NavParts {
  /** The scrolling top of the rail. */
  head: NavItem[];
  /** The buttons pinned beside Settings (never scroll away). */
  foot: NavItem[];
}

/** The rail's buttons in their two regions. The divider and Settings are not in either: they are fixed. */
export function partsOf(config: NavConfig): NavParts {
  const head: NavItem[] = [];
  const foot: NavItem[] = [];
  let into = head;
  for (const item of config.items) {
    if (isGap(item)) into = foot;
    else if (!isSettings(item)) into.push(item);
  }
  return { head, foot };
}

/** Rebuild the canonical list `[...head, divider, ...foot, Settings]` and let the sanitizer have the last word. */
function build(config: NavConfig, head: readonly NavItem[], foot: readonly NavItem[]): NavConfig {
  return sanitizeNav({
    version: 1,
    position: config.position,
    size: config.size,
    labels: config.labels,
    items: [...head, { id: 'spacer', to: { kind: 'gap' } }, ...foot, { id: 'settings', to: { kind: 'route', route: 'settings' } }],
  });
}

/** How many buttons the rail holds (the divider not counted, Settings counted). */
export const buttonCount = (config: NavConfig): number => config.items.filter((i) => !isGap(i)).length;

/** Two rails with the same content. */
export function sameNav(a: NavConfig, b: NavConfig): boolean {
  if (a === b) return true;
  if (a.position !== b.position || a.size !== b.size || a.labels !== b.labels) return false;
  return sameItems(a.items, b.items);
}

function sameItems(a: readonly NavItem[], b: readonly NavItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return x.id === y.id && targetKey(x.to) === targetKey(y.to) && x.label === y.label && x.icon === y.icon;
  });
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

export type MoveDir = 'up' | 'down';

/**
 * How many buttons the pinned foot would hold after this move. Moving the last scrolling button down pins it (the foot grows), moving the
 * first pinned button up lets it scroll again (the foot shrinks); anything else leaves the foot as it is. The screen uses this to switch
 * the arrow off when the foot is full, and `moveItem` uses it to refuse.
 */
export function nextFootCount(config: NavConfig, id: string, dir: MoveDir): number {
  const { head, foot } = partsOf(config);
  if (dir === 'down' && head.length > 0 && head[head.length - 1]!.id === id) return foot.length + 1;
  if (dir === 'up' && foot.length > 0 && foot[0]!.id === id) return foot.length - 1;
  return foot.length;
}

/**
 * One step up or down. Within a region the button swaps with its neighbour; at the end of the scrolling head, "down" pins it as the first
 * pinned button, and at the top of the pinned foot, "up" lets it scroll again as the last of the head. Settings and the divider do not
 * move, a move off either end changes nothing, and a fourth pinned button is refused.
 */
export function moveItem(config: NavConfig, id: string, dir: MoveDir): NavConfig {
  const { head, foot } = partsOf(config);
  const swap = (list: NavItem[], a: number, b: number) => {
    const t = list[a]!;
    list[a] = list[b]!;
    list[b] = t;
  };

  const h = head.findIndex((i) => i.id === id);
  if (h >= 0) {
    if (dir === 'up') {
      if (h === 0) return config;
      swap(head, h, h - 1);
    } else if (h < head.length - 1) swap(head, h, h + 1);
    else {
      if (nextFootCount(config, id, dir) > NAV_LIMITS.foot) return config;
      foot.unshift(head.pop()!);
    }
    return build(config, head, foot);
  }

  const f = foot.findIndex((i) => i.id === id);
  if (f < 0) return config;
  if (dir === 'down') {
    if (f === foot.length - 1) return config;
    swap(foot, f, f + 1);
  } else if (f > 0) swap(foot, f, f - 1);
  else head.push(foot.shift()!);
  return build(config, head, foot);
}

export const canMove = (config: NavConfig, id: string, dir: MoveDir): boolean => moveItem(config, id, dir) !== config;

/** No room for another button: the head and the pinned foot together hold 8, whatever else is true. */
export function isFull(config: NavConfig): boolean {
  const { head, foot } = partsOf(config);
  return head.length + foot.length >= MAX_BUTTONS;
}

/** Why a target cannot be added: it is already on the rail, the rail is full, or it is not something that can be added. Null: it can. */
export type AddRefusal = 'pinned' | 'full' | 'fixed';

export function canAdd(config: NavConfig, to: NavTarget): AddRefusal | null {
  if (to.kind === 'gap' || (to.kind === 'route' && to.route === 'settings')) return 'fixed';
  const key = targetKey(to);
  if (config.items.some((i) => targetKey(i.to) === key)) return 'pinned';
  return isFull(config) ? 'full' : null;
}

/** Put a button on the rail: at the end of the scrolling head (or pinned, if asked and there is room), with the usual name and icon. */
export function addItem(config: NavConfig, to: NavTarget, opts: { where?: 'head' | 'foot'; id?: string } = {}): NavConfig {
  if (canAdd(config, to) !== null) return config;
  const { head, foot } = partsOf(config);
  const item: NavItem = { id: opts.id ?? newNavId(), to };
  if (opts.where === 'foot') {
    if (foot.length >= NAV_LIMITS.foot) return config;
    foot.push(item);
  } else head.push(item);
  return build(config, head, foot);
}

/** Take a button off the rail. Settings and the divider cannot be removed. */
export function removeItem(config: NavConfig, id: string): NavConfig {
  const { head, foot } = partsOf(config);
  const inHead = head.some((i) => i.id === id);
  if (!inHead && !foot.some((i) => i.id === id)) return config;
  return build(
    config,
    head.filter((i) => i.id !== id),
    foot.filter((i) => i.id !== id),
  );
}

/** Replace one entry; the rest of the rail is kept as it was. Settings and the divider are not entries that can be changed. */
function editItem(config: NavConfig, id: string, change: (item: NavItem) => NavItem): NavConfig {
  const { head, foot } = partsOf(config);
  if (![...head, ...foot].some((i) => i.id === id)) return config;
  const each = (list: NavItem[]) => list.map((i) => (i.id === id ? change(i) : i));
  const next = build(config, each(head), each(foot));
  return sameNav(next, config) ? config : next;
}

/** The name on the button. Cleaned the way the server cleans it; nothing left (or `null`) means "use the usual name". */
export function setLabel(config: NavConfig, id: string, label: string | null): NavConfig {
  const clean = label === null ? undefined : cleanLabel(label);
  return editItem(config, id, (i) => ({ id: i.id, to: i.to, ...(clean !== undefined ? { label: clean } : {}), ...(i.icon ? { icon: i.icon } : {}) }));
}

/** The picture on the button; `null` means "use the usual one". An icon this build does not have is refused. */
export function setIcon(config: NavConfig, id: string, icon: NavIcon | null): NavConfig {
  if (icon !== null && !(NAV_ICONS as readonly string[]).includes(icon)) return config;
  return editItem(config, id, (i) => ({ id: i.id, to: i.to, ...(i.label !== undefined ? { label: i.label } : {}), ...(icon ? { icon } : {}) }));
}

/** Side of the screen, size and when names show. Fields left out stay as they are. */
export function setLook(config: NavConfig, look: { position?: NavPosition; size?: NavSize; labels?: NavLabelMode }): NavConfig {
  const next = sanitizeNav({ version: 1, position: look.position ?? config.position, size: look.size ?? config.size, labels: look.labels ?? config.labels, items: config.items }, config);
  return sameNav(next, config) ? config : next;
}

/**
 * A ready-made arrangement: its buttons, size and names REPLACE the current ones (nothing of the old buttons is kept). The side of the
 * screen is the person's own choice about where their hand is, so a preset leaves it alone.
 */
export function applyPreset(config: NavConfig, id: NavPresetId): NavConfig {
  if (!Object.prototype.hasOwnProperty.call(NAV_PRESETS, id)) return config;
  return sanitizeNav({ ...NAV_PRESETS[id], position: config.position });
}

/** The navigation as it ships. A fresh object, safe to edit. */
export const defaultNav = (): NavConfig => sanitizeNav(DEFAULT_NAV);

// ---------------------------------------------------------------------------
// How much fits
// ---------------------------------------------------------------------------

/** The two sets of rail measurements: normal screens, and the ≤520px-high ones (800x480, 1280x400). The numbers are v2/nav.css's. */
export type NavTier = 'default' | 'tight';

const BUTTON_MIN: Record<NavSize, Record<NavTier, number>> = {
  compact: { default: 48, tight: 48 },
  regular: { default: 52, tight: 52 },
  large: { default: 64, tight: 56 },
};
const RAIL_PAD: Record<NavTier, number> = { default: 10, tight: 6 };
const RAIL_GAP: Record<NavTier, number> = { default: 6, tight: 3 };
const DIVIDER_HEIGHT = 8;

/**
 * How many buttons (Settings included, the divider not) fit in a rail this tall without anything scrolling. The rail is the scrolling head
 * and the pinned foot, one divider between, and a gap before and after the divider: the padding top and bottom, the divider, and every
 * button's smallest height plus one gap (the two region gaps with the in-region ones add up to one per button).
 */
export function countFit(railHeight: number, size: NavSize, tier: NavTier): number {
  if (!Number.isFinite(railHeight) || railHeight <= 0) return 0;
  const room = railHeight - 2 * RAIL_PAD[tier] - DIVIDER_HEIGHT;
  return Math.max(0, Math.floor(room / (BUTTON_MIN[size][tier] + RAIL_GAP[tier])));
}

/** The narrowest a bottom bar's button may be, by size (the bar's CSS: --dock-btn-w and the gaps between). */
const BUTTON_MIN_W: Record<NavSize, number> = { compact: 64, regular: 76, large: 92 };
const BAR_PAD = 16;
const BAR_GAP = 4;
const BAR_DIVIDER = 13;

/** The same count for a bar along the bottom: how many buttons fit across this width without it scrolling. */
export function countFitAcross(barWidth: number, size: NavSize): number {
  if (!Number.isFinite(barWidth) || barWidth <= 0) return 0;
  const room = barWidth - BAR_PAD - BAR_DIVIDER;
  return Math.max(0, Math.floor(room / (BUTTON_MIN_W[size] + BAR_GAP)));
}

/**
 * Where the head starts to scroll, as the index of the first scrolling button in the head (the editor draws its "scrolls on this screen"
 * line before it), or null if they all fit or the rail has not been measured. The pinned buttons and Settings take their places first.
 * `hidden` are buttons the rail does not draw (an app that is gone): they take no room, so they neither count nor start the scrolling.
 */
export function scrollsAfter(config: NavConfig, fit: number | null, hidden: ReadonlySet<string> = new Set()): number | null {
  if (fit === null) return null;
  const { head, foot } = partsOf(config);
  const room = Math.max(0, fit - foot.filter((i) => !hidden.has(i.id)).length - 1);
  let drawn = 0;
  for (let at = 0; at < head.length; at++) {
    if (hidden.has(head[at]!.id)) continue;
    if (drawn === room) return at;
    drawn++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Saving the draft
// ---------------------------------------------------------------------------

/** The parts of the rail a patch can carry. A patch names only what changed, so a change made elsewhere to the rest is not undone. */
export interface NavFields {
  position?: NavPosition;
  size?: NavSize;
  labels?: NavLabelMode;
  items?: readonly NavItem[];
}

const FIELD_KEYS = ['position', 'size', 'labels', 'items'] as const;

/** What differs between two rails, as a patch body (the items list only when it really changed). */
export function changedFields(from: NavConfig, to: NavConfig): NavFields {
  const out: NavFields = {};
  if (from.position !== to.position) out.position = to.position;
  if (from.size !== to.size) out.size = to.size;
  if (from.labels !== to.labels) out.labels = to.labels;
  if (!sameItems(from.items, to.items)) out.items = to.items;
  return out;
}

const allFields = (c: NavConfig): NavFields => ({ position: c.position, size: c.size, labels: c.labels, items: c.items });

/** A timer pair, so a test can run the clock by hand. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = { set: (fn, ms) => globalThis.setTimeout(fn, ms), clear: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>) };

export const NAV_COMMIT_MS = 400;

export interface CommitScheduler {
  /** Note what changed; the send happens `delay` ms after the LAST change (several quick changes make one send that carries them all). */
  push(fields: NavFields): void;
  /** Send what is waiting, now. Nothing waiting sends nothing. */
  flush(): void;
  /** Forget what is waiting. */
  cancel(): void;
  readonly waiting: boolean;
}

/** A trailing debounce that merges what it is given: later changes to the same field win, fields never changed are not sent. */
export function createCommitScheduler(send: (patch: NavPatch) => void, opts: { delay?: number; timers?: Timers } = {}): CommitScheduler {
  const delay = opts.delay ?? NAV_COMMIT_MS;
  const timers = opts.timers ?? realTimers;
  let waiting: NavFields | null = null;
  let handle: unknown = null;
  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  const flush = () => {
    stop();
    if (!waiting) return;
    const patch: NavPatch = { version: 1, ...waiting };
    waiting = null;
    send(patch);
  };
  return {
    push(fields) {
      const given = FIELD_KEYS.filter((k) => fields[k] !== undefined);
      if (given.length === 0) return;
      // Only the fields really given: an explicit `undefined` must not wipe out an earlier change.
      const merged: NavFields = { ...waiting };
      for (const k of given) Object.assign(merged, { [k]: fields[k] });
      waiting = merged;
      stop();
      handle = timers.set(flush, delay);
    },
    flush,
    cancel() {
      stop();
      waiting = null;
    },
    get waiting() {
      return waiting !== null;
    },
  };
}

export interface NavSessionDeps {
  /** The saved rail at the moment the editor opened. */
  initial: NavConfig;
  /** Show this rail at once (the store's draft; the rail reads it). `null`: back to the saved one. */
  show(draft: NavConfig | null): void;
  /** Save these fields (a settings patch). */
  save(patch: NavPatch): void;
  delay?: number;
  timers?: Timers;
}

/**
 * One time the editor is open. The rail being edited is the DRAFT: every change shows at once, and is saved shortly after the last one
 * (and always on close, so nothing is lost). A change someone else makes to the saved rail meanwhile is not looked at here: it does not
 * show, and on close only the fields this session changed are sent, so the last writer wins on those and the rest stay as they are.
 */
export interface NavSession {
  readonly snapshot: NavConfig;
  readonly draft: NavConfig;
  /** The draft differs from what the rail was when the editor opened. */
  readonly dirty: boolean;
  edit(next: NavConfig): void;
  /**
   * Send again everything this session has changed. For when the head unit comes back after being unreachable: what was sent meanwhile
   * was dropped, and the snapshot it then sends does not have the changes. Only the fields this session touched go, so what someone
   * else changed in the others is left alone. Nothing changed, or closed: nothing sent.
   */
  resend(): void;
  /** Back to how it was when the editor opened. Saved at once. */
  revert(): void;
  /** Back to the default navigation. Saved at once. */
  reset(): void;
  flush(): void;
  /** Save what is waiting and stop showing the draft. Changes after this are ignored. */
  close(): void;
}

export function createNavSession(deps: NavSessionDeps): NavSession {
  const snapshot = sanitizeNav(deps.initial);
  let draft = snapshot;
  let closed = false;
  /** Every field this session has changed, with its latest value. */
  let touched: NavFields = {};
  const scheduler = createCommitScheduler(deps.save, { delay: deps.delay, timers: deps.timers });
  deps.show(draft);

  const replace = (next: NavConfig, fields: NavFields, now: boolean) => {
    draft = next;
    touched = { ...touched, ...fields };
    deps.show(draft);
    scheduler.push(fields);
    if (now) scheduler.flush();
  };

  return {
    snapshot,
    get draft() {
      return draft;
    },
    get dirty() {
      return !sameNav(draft, snapshot);
    },
    edit(next) {
      if (closed) return;
      const clean = sanitizeNav(next, draft);
      if (sameNav(clean, draft)) return;
      replace(clean, changedFields(draft, clean), false);
    },
    resend() {
      if (closed) return;
      scheduler.push(touched);
      scheduler.flush();
    },
    revert() {
      if (closed || sameNav(draft, snapshot)) return;
      replace(snapshot, allFields(snapshot), true);
    },
    reset() {
      if (closed) return;
      const fresh = defaultNav();
      if (sameNav(draft, fresh)) return;
      replace(fresh, allFields(fresh), true);
    },
    flush: scheduler.flush,
    close() {
      if (closed) return;
      scheduler.flush();
      closed = true;
      deps.show(null);
    },
  };
}
