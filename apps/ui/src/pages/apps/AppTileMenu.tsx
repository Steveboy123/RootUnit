import { Eye, EyeOff, Pin, PinOff } from 'lucide-react';
import { DEFAULT_LAUNCHER, DEFAULT_NAV } from '@headunit/shared';
import { needsAttention, useAppBadges } from '../../apps/badges';
import type { AppDef } from '../../apps/registry';
import { Sheet } from '../../components/ui';
import { EDIT_LOCKED_MESSAGE, isEditLocked } from '../../lib/driving';
import { openNavEditor } from '../../lib/nav';
import { isHidden, isPinned, toggleHidden, togglePin } from '../../lib/surfaces';
import { useHeadUnit } from '../../store';

export interface AppTileMenuViewProps {
  app: Pick<AppDef, 'id' | 'name'>;
  pinned: boolean;
  hidden: boolean;
  onPin(): void;
  onHide(): void;
  onClose(): void;
}

/** What a held app tile offers: put the app on the navigation (or take it off), hide it from the launcher (or bring it back). */
export function AppTileMenuView({ app, pinned, hidden, onPin, onHide, onClose }: AppTileMenuViewProps) {
  return (
    <Sheet title={app.name} onClose={onClose}>
      <button type="button" className="btn block" onClick={onPin}>
        {pinned ? <PinOff /> : <Pin />}
        {pinned ? 'Remove from navigation' : 'Add to navigation'}
      </button>
      <button type="button" className="btn block" onClick={onHide}>
        {hidden ? <Eye /> : <EyeOff />}
        {hidden ? 'Show in the launcher' : 'Hide from the launcher'}
      </button>
      <p className="dim" style={{ fontSize: '0.86rem' }}>
        {hidden ? 'Showing it puts it back in its group on the Apps screen.' : 'A hidden app stays on the navigation if you added it there, and comes back from the Hidden button at the top of the Apps screen.'}
      </p>
    </Sheet>
  );
}

/**
 * The menu for one app. Pinning adds the app at the end of the dock's scrolling part and saves at once; a dock that has no room says so
 * and opens the editor, where something can be taken off to make room.
 */
export function AppTileMenu({ app, onClose }: { app: AppDef; onClose(): void }) {
  const nav = useHeadUnit((s) => s.settings?.nav ?? DEFAULT_NAV);
  const launcher = useHeadUnit((s) => s.settings?.launcher ?? DEFAULT_LAUNCHER);
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const toast = useHeadUnit((s) => s.showToast);
  const badges = useAppBadges();
  const pinned = isPinned(nav, app.id);
  const hidden = isHidden(launcher, app.id);

  const pin = () => {
    onClose();
    if (isEditLocked()) return toast(EDIT_LOCKED_MESSAGE);
    const change = togglePin(nav, app.id);
    if (change.kind === 'full') {
      toast('Navigation is full');
      openNavEditor();
      return;
    }
    patchSettings({ nav: { version: 1, items: change.nav.items } });
    toast(change.kind === 'pin' ? `Added ${app.name} to the navigation` : `Removed ${app.name} from the navigation`);
  };
  const hide = () => {
    onClose();
    if (isEditLocked()) return toast('Pull over to change the launcher');
    const next = toggleHidden(launcher, app.id);
    if (next === launcher) return toast('Too many hidden apps. Show one first.');
    patchSettings({ launcher: { version: 1, hidden: next.hidden } });
    toast(hidden ? `${app.name} is back in the launcher` : needsAttention(badges[app.id]) ? `${app.name} is hidden, but stays on the Apps screen while it needs attention.` : `${app.name} hidden. Tap Hidden at the top to find it.`);
  };
  return <AppTileMenuView app={app} pinned={pinned} hidden={hidden} onPin={pin} onHide={hide} onClose={onClose} />;
}
