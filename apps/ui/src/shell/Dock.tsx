import { Component, memo, useCallback, useLayoutEffect, useMemo, useState, type ErrorInfo, type ReactNode, type Ref } from 'react';
import { Car, Check, Gauge, House, LayoutGrid, Music2, Settings, type LucideIcon } from 'lucide-react';
import type { DockStyle, NavLabelMode, NavPosition, NavSize } from '@headunit/shared';
import { useAttentionBadges } from '../apps/badges';
import { apiRequest } from '../lib/api';
import { applyScene, sceneSummary } from '../lib/scenes';
import { openNavEditor, runTarget, useLongPress, type LongPressProps, type ResolvedNavItem } from '../lib/nav';
import { useArmedStep } from '../lib/nav/armed';
import { useRailScroll, type RailFade } from '../lib/nav/scroll';
import { useActiveNavId, useNavConfig, useResolvedNav } from '../lib/nav/useNav';
import { MASCOT_ASSETS } from '../layers/Mascot';
import { useNowPlaying } from '../lib/nowPlaying';
import { useHeadUnit, type Route } from '../store';

type Tone = 'ok' | 'warn' | 'danger' | 'info';

const DEFAULT_LOOK = { position: 'left', size: 'regular', labels: 'always', style: 'island' } as const;

/** The dock's two parts: the scrolling head, and the foot that stays put (the extra pinned buttons and Settings). */
export function splitDock(items: readonly ResolvedNavItem[]): { head: ResolvedNavItem[]; foot: ResolvedNavItem[] } {
  const visible = items.filter((i) => i.state !== 'missing');
  const gap = visible.findIndex((i) => i.kind === 'gap');
  if (gap < 0) return { head: visible, foot: [] };
  return { head: visible.slice(0, gap).filter((i) => i.kind !== 'gap'), foot: visible.slice(gap + 1).filter((i) => i.kind !== 'gap') };
}

const TONE_WORD: Record<Tone, string> = { ok: 'running', warn: 'needs a look', danger: 'needs attention', info: 'new' };
const toneWord = (tone: string): string => (Object.prototype.hasOwnProperty.call(TONE_WORD, tone) ? TONE_WORD[tone as Tone] : 'needs a look');

/**
 * The highlight behind the current page's button: one element per part of the dock that slides (with a spring) to whichever button is
 * active. It measures the button, so it follows any size, label mode or scroll position.
 */
function Indicator({ container, activeId, items }: { container: HTMLDivElement | null; activeId: string | null; items: readonly ResolvedNavItem[] }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!container) return;
    const measure = () => {
      const el = activeId ? container.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(activeId)}"]`) : null;
      setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [container, activeId, items]);
  return (
    <i
      className="dock-ind"
      aria-hidden="true"
      style={{ opacity: box ? 1 : 0, ['--x' as string]: `${box?.x ?? 0}px`, ['--y' as string]: `${box?.y ?? 0}px`, ['--w' as string]: `${box?.w ?? 0}px`, ['--h' as string]: `${box?.h ?? 0}px` }}
    />
  );
}

export interface DockViewProps {
  items: readonly ResolvedNavItem[];
  activeId: string | null;
  armedId?: string | null;
  badges?: Readonly<Record<string, { tone: Tone }>>;
  editing?: boolean;
  onSelect?(item: ResolvedNavItem): void;
  gesture?: LongPressProps;
  /** A small picture of the dock (Settings, the editor): not a landmark, not focusable, not tappable. */
  preview?: boolean;
  scroll?: { ref: Ref<HTMLDivElement>; onScroll(): void; fade: RailFade };
  /** The centre piece of the split and mascot styles (album art, or the mascot), drawn halfway along the buttons. */
  medallion?: ReactNode;
  /** Where the dock is and how it looks (set on the dock itself, so a preview is never styled by the app's own dock). */
  look?: { position: NavPosition; size: NavSize; labels: NavLabelMode; style: DockStyle };
}

/** The dock drawn from already-resolved items. No store: the connected Dock feeds it, and so can a preview. */
export function DockView({ items, activeId, armedId = null, badges, editing = false, onSelect, gesture, preview = false, scroll, medallion, look = DEFAULT_LOOK }: DockViewProps) {
  const attrs = { 'data-pos': look.position, 'data-size': look.size, 'data-labels': look.labels, 'data-look': look.style };
  const { head, foot } = splitDock(items);
  const [headEl, setHeadEl] = useState<HTMLDivElement | null>(null);
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  const headRef = useCallback(
    (el: HTMLDivElement | null) => {
      setHeadEl(el);
      const r = scroll?.ref;
      if (typeof r === 'function') r(el);
      else if (r && typeof r === 'object') (r as { current: HTMLDivElement | null }).current = el;
    },
    [scroll?.ref],
  );

  const button = (item: ResolvedNavItem) => {
    const active = item.id === activeId;
    const armed = item.id === armedId;
    const loading = item.state === 'loading';
    const badge = badges && Object.prototype.hasOwnProperty.call(badges, item.id) ? badges[item.id] : undefined;
    const Icon = armed ? Check : item.Icon;
    return (
      <button
        key={item.id}
        type="button"
        className="dock-btn"
        data-nav-id={item.id}
        data-active={active}
        data-armed={armed || undefined}
        aria-current={active && !preview ? 'page' : undefined}
        aria-disabled={loading || undefined}
        aria-label={badge ? `${item.label}, ${toneWord(badge.tone)}` : item.label}
        tabIndex={preview ? -1 : undefined}
        onClick={preview ? undefined : () => !loading && onSelect?.(item)}
      >
        <Icon />
        <span>{item.label}</span>
        {(item.kind === 'run' || item.to.kind === 'music') && <i className="dock-dot" aria-hidden="true" />}
        {badge && <i className="dock-badge" data-tone={badge.tone} aria-hidden="true" />}
      </button>
    );
  };

  const headActive = head.some((i) => i.id === activeId);
  const footActive = foot.some((i) => i.id === activeId);
  const body = (
    <>
      <div className="dock-brand" aria-hidden="true">
        <i />
      </div>
      <div className="dock-scroll" ref={headRef} onScroll={scroll?.onScroll} data-fade-top={scroll?.fade.top || undefined} data-fade-bottom={scroll?.fade.bottom || undefined} {...gesture}>
        <Indicator container={headEl} activeId={headActive ? activeId : null} items={head} />
        {medallion ? (
          <>
            {head.slice(0, Math.ceil(head.length / 2)).map(button)}
            {medallion}
            {head.slice(Math.ceil(head.length / 2)).map(button)}
          </>
        ) : (
          head.map(button)
        )}
      </div>
      {foot.length > 0 && <i className="dock-gap" />}
      <div className="dock-foot" ref={setFootEl} {...gesture}>
        <Indicator container={footEl} activeId={footActive ? activeId : null} items={foot} />
        {foot.map(button)}
      </div>
    </>
  );
  return preview ? (
    <div className="dock" aria-hidden="true" inert {...attrs}>
      {body}
    </div>
  ) : (
    <nav className="dock" aria-label="Main" data-editing={editing || undefined} {...attrs}>
      {body}
      <span className="dock-say" role="status">
        {armedId ? `${items.find((i) => i.id === armedId)?.label ?? 'This button'}: tap again to confirm` : ''}
      </span>
    </nav>
  );
}

/** The dock the person has built. Re-renders only when what it draws changes (never with the speed). */
export const Dock = memo(function Dock() {
  const config = useNavConfig();
  const items = useResolvedNav();
  const activeId = useActiveNavId(items);
  const editorOpen = useHeadUnit((s) => s.navEditor !== null);
  const toast = useHeadUnit((s) => s.showToast);
  const scenes = useHeadUnit((s) => s.svc.scenes);
  const { armedId, tap: armTap, clear: armClear } = useArmedStep();
  const attention = useAttentionBadges();
  const badges = useMemo(() => Object.fromEntries(items.flatMap((i) => (i.to.kind === 'app' && i.state === 'ok' && attention.has(i.to.app) ? [[i.id, attention.get(i.to.app)!] as const] : []))), [items, attention]);
  const scrollKey = useMemo(() => `${activeId}|${items.map((i) => i.id).join(',')}|${config.size}`, [activeId, items, config.size]);
  const across = config.position === 'bottom';
  const scroll = useRailScroll(scrollKey, across ? 'x' : 'y');
  const dockStyle = useHeadUnit((s) => s.settings?.dockStyle ?? 'island');
  const medallion = dockStyle === 'split' || dockStyle === 'mascot' ? <DockMedallion kind={dockStyle} /> : undefined;

  // Hold to edit. The editor itself refuses (with a toast) while the car moves or the head unit is unreachable.
  const gesture = useLongPress({ onLongPress: () => void openNavEditor(), enabled: !editorOpen });

  const onSelect = useCallback(
    (item: ResolvedNavItem) => {
      if (item.kind === 'go') {
        // The dock must never become a dead end: choosing a destination closes the editor (which flushes its draft).
        if (useHeadUnit.getState().navEditor) useHeadUnit.getState().setNavEditor(null);
        armClear();
        return runTarget(item);
      }
      if (item.kind !== 'run' || item.state !== 'ok') return;
      // A scene or action changes the car's state, so it always needs a second, deliberate tap.
      const effect = armTap(item.id);
      if (effect === 'arm') return toast(`Tap again: ${item.label}`);
      if (effect !== 'run') return;
      if (item.to.kind === 'scene') {
        const id = item.to.scene;
        const scene = scenes?.find((s) => s.id === id);
        if (scene) void applyScene(scene).then((fx) => toast(sceneSummary(scene, fx)));
      } else if (item.to.kind === 'action') {
        const name = item.label;
        apiRequest<{ ok: boolean; message: string }>(`/api/actions/${encodeURIComponent(item.to.action)}/run`, 'POST').then(
          (r) => toast(`${name}: ${r.message}`),
          (e: unknown) => toast(e instanceof Error ? e.message : 'That did not work.'),
        );
      }
    },
    [armClear, armTap, scenes, toast],
  );

  const look = useMemo(() => ({ position: config.position, size: config.size, labels: config.labels, style: dockStyle }), [config.position, config.size, config.labels, dockStyle]);
  return <DockView items={items} activeId={activeId} armedId={armedId} badges={badges} editing={editorOpen} onSelect={onSelect} gesture={gesture} scroll={scroll} medallion={medallion} look={look} />;
});

/**
 * The centre piece of the split and mascot bars: the album art of what is playing (a slowly turning disc while it plays), or the mascot in
 * a glowing ring. A tap opens Now Playing.
 */
export function DockMedallion({ kind, preview = false }: { kind: 'split' | 'mascot'; preview?: boolean }) {
  const np = useNowPlaying();
  const variant = useHeadUnit((s) => s.settings?.mascotVariant ?? 'transparent');
  const go = useHeadUnit((s) => s.go);
  const art = kind === 'split' ? np?.artUrl : undefined;
  return (
    <button
      type="button"
      className="dock-medal"
      data-kind={kind}
      data-playing={Boolean(np?.playing)}
      aria-label={np ? `Now playing: ${np.title}` : 'Now playing'}
      tabIndex={preview ? -1 : undefined}
      onClick={preview ? undefined : () => go('nowplaying')}
    >
      <span className="dock-medal-ring fx" aria-hidden="true" />
      {kind === 'mascot' ? (
        <img className="dock-medal-mascot" src={MASCOT_ASSETS[variant] ?? MASCOT_ASSETS.transparent} alt="" draggable={false} />
      ) : (
        <span className="dock-medal-art fx fx-drive" style={art ? { backgroundImage: `url(${JSON.stringify(art)})` } : undefined} aria-hidden="true">
          {!art && <Music2 />}
        </span>
      )}
    </button>
  );
}

/**
 * The dock the head unit falls back to when the configurable one cannot be drawn. Written out by hand, on purpose: it must not depend
 * on the stored config, the sanitizers or the resolver, because any of those may be what just failed.
 */
const FALLBACK: ReadonlyArray<{ route: Route; label: string; Icon: LucideIcon }> = [
  { route: 'home', label: 'Home', Icon: House },
  { route: 'drive', label: 'Drive', Icon: Gauge },
  { route: 'media', label: 'Music', Icon: Music2 },
  { route: 'aa', label: 'Auto', Icon: Car },
  { route: 'apps', label: 'Apps', Icon: LayoutGrid },
];

export function FallbackDock() {
  // Only the side is read (a plain string, checked here), so the fallback still lines up with the page.
  const position = useHeadUnit((s) => s.settings?.nav?.position);
  const route = useHeadUnit((s) => s.route);
  const go = useHeadUnit((s) => s.go);
  const here = route === 'app' || route === 'devices' || route === 'vehicle' ? 'apps' : route === 'nowplaying' ? 'media' : route;
  const button = ({ route: r, label, Icon }: { route: Route; label: string; Icon: LucideIcon }) => (
    <button key={r} type="button" className="dock-btn" data-active={here === r} aria-current={here === r ? 'page' : undefined} aria-label={label} onClick={() => go(r)}>
      <Icon />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="dock" aria-label="Main" data-fallback="true" data-pos={position === 'bottom' || position === 'right' ? position : 'left'}>
      <div className="dock-scroll">{FALLBACK.map(button)}</div>
      <i className="dock-gap" />
      <div className="dock-foot">{button({ route: 'settings', label: 'Settings', Icon: Settings })}</div>
    </nav>
  );
}

interface CatcherProps {
  resetKey: unknown;
  children?: ReactNode;
}
interface CatcherState {
  failed: boolean;
  key: unknown;
}

/** If drawing the dock throws, the page keeps working and shows the fixed default dock instead of a blank screen. */
export class DockCatcher extends Component<CatcherProps, CatcherState> {
  override state: CatcherState = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<CatcherState> {
    return { failed: true };
  }

  /** A changed config (fixed in Settings, or reset) is a reason to try the real dock again. */
  static getDerivedStateFromProps(props: CatcherProps, state: CatcherState): Partial<CatcherState> | null {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Navigation dock failed; showing the default dock.', error, info.componentStack);
  }

  override render() {
    return this.state.failed ? <FallbackDock /> : this.props.children;
  }
}

export function DockBoundary() {
  const nav = useHeadUnit((s) => s.navDraft ?? s.settings?.nav ?? null);
  return (
    <DockCatcher resetKey={nav}>
      <Dock />
    </DockCatcher>
  );
}
