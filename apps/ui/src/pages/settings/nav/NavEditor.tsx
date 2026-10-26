import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_NAV, type NavConfig, type NavPosition } from '@headunit/shared';
import { APPS } from '../../../apps/registry';
import { useTypingLocked } from '../../../lib/driving';
import { resolveNav, type NavContext } from '../../../lib/nav';
import { countFit, countFitAcross, createNavSession, sameNav, type NavSession } from '../../../lib/navEdit';
import { useHeadUnit } from '../../../store';
import { NavEditorView, type NavScreen, type NavTab } from './NavEditorView';

/** The rail on screen (not a preview of it), if there is one. */
const liveRail = () => document.querySelector<HTMLElement>('.app nav.dock');

/**
 * How many buttons fit in the live rail without it scrolling, or null when it cannot be measured (no rail yet, no ResizeObserver). The
 * rail is measured as it is drawn, so the answer follows the screen, the size chosen and the on-screen keyboard. It is looked up again
 * when the side changes, because the rail is a different element on each side.
 */
function useRailFit(position: NavPosition, size: NavConfig['size']): number | null {
  // The rail is a new element when the side changes, whether the app follows the draft at once or only the saved rail; look it up again for either.
  const savedPosition = useHeadUnit((s) => s.settings?.nav.position);
  const [height, setHeight] = useState<number | null>(null);
  const [tight, setTight] = useState(false);
  useEffect(() => {
    const rail = liveRail();
    if (!rail) return setHeight(null);
    const read = () => {
      // Across the bottom the bar's length is its width.
      const length = position === 'bottom' ? rail.clientWidth : rail.clientHeight;
      setHeight(length > 0 ? length : null);
      setTight(typeof matchMedia === 'function' && matchMedia('(max-height: 520px)').matches);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [position, savedPosition]);
  if (height === null) return null;
  return position === 'bottom' ? countFitAcross(height, size) : countFit(height, size, tight ? 'tight' : 'default');
}

/**
 * The connected editor, mounted once by App while `navEditor` is set. It owns one editing session: the working draft goes to the store
 * (the rail reads it, so every change shows at once) and is saved 400 ms after the last change, and always when the panel closes, is
 * unmounted, the page is hidden, or the car starts moving (the lock card then replaces the body). All of that logic is in lib/navEdit.
 */
export function NavEditor() {
  const tab: NavTab = useHeadUnit((s) => s.navEditor?.tab ?? 'items');
  const draft = useHeadUnit((s) => s.navDraft ?? s.settings?.nav ?? DEFAULT_NAV);
  const offline = useHeadUnit((s) => s.conn !== 'open');
  const scenes = useHeadUnit((s) => s.svc.scenes);
  const actions = useHeadUnit((s) => s.svc.actions);
  const toast = useHeadUnit((s) => s.showToast);
  const locked = useTypingLocked();
  const [screen, setScreen] = useState<NavScreen>({ kind: 'main' });
  // The rail as it was when the editor opened: what Revert goes back to, and what "changed" is measured against.
  const [snapshot] = useState(() => useHeadUnit.getState().settings?.nav ?? DEFAULT_NAV);
  const session = useRef<NavSession | null>(null);

  useEffect(() => {
    const st = useHeadUnit.getState;
    const s = createNavSession({ initial: snapshot, show: (d) => st().setNavDraft(d), save: (patch) => st().patchSettings({ nav: patch }) });
    session.current = s;
    // A page that is being hidden or closed gets no later chance to save.
    const flush = () => s.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      s.close();
      session.current = null;
    };
  }, [snapshot]);

  // The head unit is back after being out of reach: what was sent meanwhile was dropped, so send this session's changes again. Wait for the
  // first full snapshot of the new connection (it is built before the resent patch arrives, and would overwrite it on this screen).
  const snapshots = useHeadUnit((s) => s.snapshots);
  const lostAt = useRef<number | null>(null);
  useEffect(() => {
    if (offline) lostAt.current = snapshots;
    else if (lostAt.current !== null && snapshots !== lostAt.current) {
      lostAt.current = null;
      session.current?.resend();
    }
  }, [offline, snapshots]);

  // The car started moving: save what there is and close. A panel left open would cover the screen and stop the rail from working, and
  // nothing in it can be changed while driving anyway; Close is the only thing the lock card ever offered.
  useEffect(() => {
    if (!locked) return;
    session.current?.flush();
    session.current?.close();
    useHeadUnit.getState().setNavEditor(null);
    toast('Navigation saved. Park to change it again');
  }, [locked, toast]);

  // A modal dialog for anyone who cannot see the screen: the page behind it is switched off while it is open, Escape works wherever
  // the focus is (one step back from a detail screen or the Add picker, closed from the list), and focus goes back to what opened it.
  const back = useRef<() => void>(() => {});
  // Read while rendering: the panel's own heading takes focus in an effect, which runs before this component's effects do.
  const [opener] = useState<HTMLElement | null>(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));
  useEffect(() => {
    const page = document.querySelector('.app > .main');
    page?.setAttribute('inert', '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      back.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      page?.removeAttribute('inert');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  const ctx = useMemo<NavContext>(() => ({ apps: APPS, scenes, actions }), [scenes, actions]);
  const items = useMemo(() => resolveNav(draft, ctx), [draft, ctx]);
  const fit = useRailFit(draft.position, draft.size);

  const close = () => {
    session.current?.close();
    useHeadUnit.getState().setNavEditor(null);
  };
  back.current = () => (screen.kind === 'main' ? close() : setScreen({ kind: 'main' }));

  return (
    <NavEditorView
      config={draft}
      items={items}
      ctx={ctx}
      tab={tab}
      screen={screen}
      fit={fit}
      offline={offline}
      dirty={!sameNav(draft, snapshot)}
      onTab={(t) => {
        setScreen({ kind: 'main' });
        useHeadUnit.getState().setNavEditor({ tab: t });
      }}
      onScreen={setScreen}
      onChange={(next) => session.current?.edit(next)}
      onRevert={() => session.current?.revert()}
      onReset={() => {
        session.current?.reset();
        toast('Navigation reset to the default');
      }}
      onClose={close}
      notify={toast}
    />
  );
}
