import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, type FocusEvent } from 'react';
import { ArrowDownToLine, ChevronLeft, Pin, Plus, Undo2, WifiOff, X } from 'lucide-react';
import { NAV_LIMITS, type NavConfig, type NavTarget } from '@headunit/shared';
import { useTypingLocked } from '../../../lib/driving';
import type { NavContext, ResolvedNavItem } from '../../../lib/nav';
import { MAX_BUTTONS, addItem, canMove, moveItem, partsOf, removeItem, scrollsAfter, setIcon, setLabel } from '../../../lib/navEdit';
import { ConfirmButton, Banner, Segment } from '../../../components/ui';
import { DrivingGate } from '../../../components/ui';
import { fieldScrollTop } from '../../../components/ui';
import { describeTarget } from './describe';
import { NavAddPicker } from './NavAddPicker';
import { NavDetail } from './NavDetail';
import { NavItemRow } from './NavItemRow';
import { NavLook } from './NavLook';

export type NavScreen = { kind: 'main' } | { kind: 'detail'; id: string } | { kind: 'add' };
export type NavTab = 'items' | 'look';

export interface NavEditorViewProps {
  /** The rail being edited (the draft). */
  config: NavConfig;
  /** The draft with its targets looked up: names, pictures, and which ones are missing. */
  items: readonly ResolvedNavItem[];
  /** The live lists the Add picker offers. */
  ctx: NavContext;
  tab: NavTab;
  screen: NavScreen;
  /** How many buttons fit on this screen without the rail scrolling; null until the rail has been measured. */
  fit: number | null;
  /** The head unit cannot be reached: nothing can be saved, so nothing can be changed. */
  offline?: boolean;
  /** The draft differs from how the rail was when the editor opened (Revert has something to undo). */
  dirty?: boolean;
  onTab(tab: NavTab): void;
  onScreen(screen: NavScreen): void;
  onChange(next: NavConfig): void;
  onRevert(): void;
  onReset(): void;
  onClose(): void;
  /** A short message for the toast ("Added Weather"). */
  notify?(message: string): void;
}

const MAIN: NavScreen = { kind: 'main' };

/** A layout effect where there is a layout; on the server (the tests) it is an ordinary effect, which never runs. */
const useLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Focus lands in a text field: bring it near the top of the scrolling body, clear of the on-screen keyboard (the same rule the sheets use). */
function revealField(e: FocusEvent<HTMLDivElement>) {
  const field = e.target;
  const body = e.currentTarget;
  if (!(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
  window.setTimeout(() => {
    const b = body.getBoundingClientRect();
    const f = field.getBoundingClientRect();
    const k = b.height > 0 ? body.clientHeight / b.height : 1;
    body.scrollTo?.({ top: fieldScrollTop({ scrollTop: body.scrollTop, bodyTop: b.top, fieldTop: f.top, k }), behavior: 'smooth' });
  }, 120);
}

/**
 * The navigation editor's panel, drawn from its props alone: a docked panel (not a full-width modal) beside the rail, so the rail stays
 * uncovered and every change shows on it at once. Close and Reset are always on the header, outside the driving lock; the rest of the
 * panel is behind it (a car that starts moving mid-edit replaces the body with the lock card), and is switched off while the head unit
 * cannot be reached. Three screens: the list (Items | Look), one button's detail, and the Add picker.
 */
export function NavEditorView(props: NavEditorViewProps) {
  const { config, items, ctx, tab, screen, fit, offline = false, dirty = false, onTab, onScreen, onChange, onRevert, onReset, onClose, notify } = props;
  const locked = useTypingLocked();
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** Where each list was scrolled to, so coming back from a detail screen (or the other tab) leaves you where you were. */
  const scrolled = useRef(new Map<string, number>());
  /** The button just added: the list comes back with it in view, not scrolled to the top with the new row somewhere below. */
  const reveal = useRef<string | null>(null);

  const detailItem = screen.kind === 'detail' ? items.find((i) => i.id === screen.id && !i.fixed && i.kind !== 'gap' && i.state !== 'missing') : undefined;
  const current: NavScreen = screen.kind === 'detail' && !detailItem ? MAIN : screen;
  const title = current.kind === 'add' ? 'Add a button' : detailItem && current.kind === 'detail' ? detailItem.label : 'Navigation';

  const viewKey = current.kind === 'main' ? `main:${tab}` : current.kind;
  useLayout(() => {
    // The two sub-screens always open at the top; the lists remember their place.
    if (body.current) body.current.scrollTop = current.kind === 'main' ? (scrolled.current.get(viewKey) ?? 0) : 0;
  }, [viewKey, current.kind]);

  useLayout(() => {
    const id = reveal.current;
    if (!id || current.kind !== 'main' || tab !== 'items') return;
    const row = body.current?.querySelector(`[data-nav-id="${CSS.escape(id)}"]`);
    if (!row) return; // not drawn yet: this runs again when the buttons change
    reveal.current = null;
    row.scrollIntoView?.({ block: 'nearest' });
  }, [items, current.kind, tab]);

  // Focus starts in the panel (on its title, which names the dialog) and returns there whenever the screen changes, so a button that has
  // just gone away does not leave focus nowhere. It is not a text field: the on-screen keyboard stays down until one is tapped.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [current.kind]);

  const remove = (item: ResolvedNavItem) => {
    onChange(removeItem(config, item.id));
    notify?.(`Removed ${item.label}`);
  };
  const add = (to: NavTarget, name: string) => {
    const next = addItem(config, to);
    if (next === config) return;
    reveal.current = next.items.find((i) => !config.items.some((o) => o.id === i.id))?.id ?? null;
    onChange(next);
    onScreen(MAIN);
    notify?.(`Added ${name}`);
  };

  return (
    <div className="ne-scrim" onClick={onClose} data-no-swipe data-no-edge-back>
      <div className="ne-panel" role="dialog" aria-modal="true" aria-label="Edit navigation" data-screen={current.kind} onClick={(e) => e.stopPropagation()}>
        <header className="ne-head">
          {current.kind !== 'main' && (
            <button type="button" className="ne-btn" aria-label="Back to the list of buttons" onClick={() => onScreen(MAIN)}>
              <ChevronLeft size={20} />
              Back
            </button>
          )}
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {current.kind === 'main' && (
            <fieldset className="ne-actions" disabled={offline || locked}>
              <button type="button" className="ne-btn" disabled={!dirty} onClick={onRevert}>
                <Undo2 size={18} />
                Revert
              </button>
              <ConfirmButton label="Reset all" confirmLabel="Tap again" className="btn danger ne-btn" onConfirm={onReset} />
            </fieldset>
          )}
          <button type="button" className="ne-btn sq" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </header>

        {offline && (
          <Banner tone="warn" icon={WifiOff}>
            The head unit cannot be reached, so changes could not be saved. They are switched off until it is back.
          </Banner>
        )}

        <div className="ne-content">
          <DrivingGate what="Editing navigation">
            <fieldset className="ne-fields" disabled={offline}>
              {current.kind === 'main' && (
                <div className="ne-tabs">
                  <Segment
                    label="Section"
                    value={tab}
                    options={[
                      { value: 'items', label: 'Items' },
                      { value: 'look', label: 'Look' },
                    ]}
                    onChange={onTab}
                  />
                  {tab === 'items' && (
                    <button type="button" className="ne-btn primary" onClick={() => onScreen({ kind: 'add' })}>
                      <Plus size={18} />
                      Add
                    </button>
                  )}
                </div>
              )}
              <div className="ne-body" ref={body} onFocusCapture={revealField} onScroll={(e) => scrolled.current.set(viewKey, e.currentTarget.scrollTop)}>
                {current.kind === 'add' && <NavAddPicker config={config} ctx={ctx} onAdd={add} />}
                {current.kind === 'detail' && detailItem && (
                  <NavDetail
                    key={detailItem.id}
                    item={detailItem}
                    usual={describeTarget(detailItem.to, ctx)}
                    onLabel={(text) => onChange(setLabel(config, detailItem.id, text))}
                    onIcon={(icon) => onChange(setIcon(config, detailItem.id, icon))}
                    onRemove={() => {
                      remove(detailItem);
                      onScreen(MAIN);
                    }}
                  />
                )}
                {current.kind === 'main' && tab === 'look' && <NavLook config={config} onChange={onChange} />}
                {current.kind === 'main' && tab === 'items' && <ItemsList config={config} items={items} fit={fit} onOpen={(id) => onScreen({ kind: 'detail', id })} onChange={onChange} onRemove={remove} />}
              </div>
            </fieldset>
          </DrivingGate>
        </div>
      </div>
    </div>
  );
}

interface ItemsListProps {
  config: NavConfig;
  items: readonly ResolvedNavItem[];
  fit: number | null;
  onOpen(id: string): void;
  onChange(next: NavConfig): void;
  onRemove(item: ResolvedNavItem): void;
}

/**
 * The buttons in rail order: the scrolling head, then a line for the pinned foot, then Settings. A second line marks where the rail will
 * start to scroll on THIS screen (measured from the live rail), so a person who has added many buttons sees which ones are past it.
 */
function ItemsList({ config, items, fit, onOpen, onChange, onRemove }: ItemsListProps) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const { head, foot } = partsOf(config);
  // A button whose target is gone is not drawn on the rail, so it takes no room there.
  const gone = useMemo(() => new Set(items.filter((i) => i.state === 'missing').map((i) => i.id)), [items]);
  const scrollsAt = scrollsAfter(config, fit, gone);
  const settings = items.find((i) => i.fixed);

  const row = (id: string) => {
    const item = byId.get(id);
    if (!item) return null;
    return (
      <NavItemRow
        key={id}
        item={item}
        canUp={canMove(config, id, 'up')}
        canDown={canMove(config, id, 'down')}
        onOpen={() => onOpen(id)}
        onUp={() => onChange(moveItem(config, id, 'up'))}
        onDown={() => onChange(moveItem(config, id, 'down'))}
        onRemove={() => onRemove(item)}
      />
    );
  };

  return (
    <>
      <ul className="ne-list" aria-label="Buttons on the navigation">
        {head.map((it, i) => (
          <Fragment key={it.id}>
            {scrollsAt === i && (
              <li className="ne-line" data-kind="scroll">
                <ArrowDownToLine size={16} aria-hidden="true" />
                <span>Buttons below this line scroll on this screen</span>
              </li>
            )}
            {row(it.id)}
          </Fragment>
        ))}
        <li className="ne-line" data-kind="pinned">
          <Pin size={16} aria-hidden="true" />
          <span>
            Pinned below: always in view, never scroll ({foot.length} of {NAV_LIMITS.foot})
          </span>
        </li>
        {foot.map((it) => row(it.id))}
        {settings && row(settings.id)}
      </ul>
      <p className="ne-note">
        {head.length + foot.length} of {MAX_BUTTONS} buttons used, and Settings is always there too. Tap a name to rename it or change its picture, and use the arrows to move it. Up to {NAV_LIMITS.foot} can
        be pinned below the line.
      </p>
    </>
  );
}
