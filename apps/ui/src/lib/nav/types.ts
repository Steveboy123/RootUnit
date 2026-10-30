import type { LucideIcon } from 'lucide-react';
import type { NavIcon, NavTarget, QuickActionPublic, Scene } from '@headunit/shared';
import type { AppDef } from '../../apps/registry';
import type { MusicTab, Route } from '../../store';

/** What the rail needs to know about the rest of the head unit to draw its items. Passed in, so everything here is testable. */
export interface NavContext {
  apps: ReadonlyArray<Pick<AppDef, 'id' | 'name' | 'short' | 'icon' | 'route'>>;
  /** Undefined until the server has sent them: an item that points at one is dimmed meanwhile, not hidden. */
  scenes: readonly Scene[] | undefined;
  actions: readonly QuickActionPublic[] | undefined;
}

export interface NavPlace {
  route: Route;
  appId: string | null;
  musicTab: MusicTab;
}

export interface ResolvedNavItem {
  id: string;
  to: NavTarget;
  /** go: opens a place · run: a scene or action (needs a second tap) · gap: the divider. */
  kind: 'go' | 'run' | 'gap';
  /** What the button says: the custom label, or the default for its target. Never empty for go and run. */
  label: string;
  /** The label the person typed, if any (the editor shows it for editing). */
  customLabel: string | null;
  /** The picture drawn: the chosen icon, or the default for the target. */
  Icon: LucideIcon;
  /** The chosen icon's id, if any. */
  iconId: NavIcon | null;
  /**
   * ok · loading (a scene or action list the server has not sent yet: drawn dimmed and disabled) ·
   * missing (the app, scene or action no longer exists: not drawn on the rail, listed as Missing in the editor).
   */
  state: 'ok' | 'loading' | 'missing';
  /** Settings: always there, always last, name and icon fixed. */
  fixed: boolean;
  /** For an app that is really a page (Phones, Vehicle): the route it opens, so the page counts as this item being active. */
  appRoute: Route | null;
}
