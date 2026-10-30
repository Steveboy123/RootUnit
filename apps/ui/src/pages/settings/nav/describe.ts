import type { LucideIcon } from 'lucide-react';
import type { NavConfig, NavTarget } from '@headunit/shared';
import { resolveNav, type NavContext } from '../../../lib/nav';

export interface TargetInfo {
  /** The name the button would carry with no label of its own. */
  label: string;
  /** The picture it would carry with no icon of its own. */
  Icon: LucideIcon;
}

/**
 * What a destination is called and drawn as by default. Asking the rail's own resolver (rather than keeping a second table here) means the
 * editor can never disagree with the button it is editing: a pinned app shows its short name, a scene its own icon, and so on.
 */
export function describeTarget(to: NavTarget, ctx: NavContext): TargetInfo {
  const probe: NavConfig = { version: 1, position: 'left', size: 'regular', labels: 'always', items: [{ id: 'probe', to }] };
  const first = resolveNav(probe, ctx)[0]!;
  return { label: first.label, Icon: first.Icon };
}
