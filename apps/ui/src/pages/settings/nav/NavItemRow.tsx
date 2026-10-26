import { ArrowDown, ArrowUp, ChevronRight, Lock, Trash2 } from 'lucide-react';
import type { ResolvedNavItem } from '../../../lib/nav';
import { Badge } from '../../../components/ui';

export interface NavItemRowProps {
  item: ResolvedNavItem;
  canUp: boolean;
  canDown: boolean;
  onOpen(): void;
  onUp(): void;
  onDown(): void;
  onRemove(): void;
}

/** One line under the name: what kind of button this is (and, for a scene or action, the second tap it asks for). */
function hintOf(item: ResolvedNavItem): string {
  if (item.state === 'loading') return 'Waiting for the head unit…';
  switch (item.to.kind) {
    case 'route':
      return 'Page';
    case 'app':
      return 'App';
    case 'music':
      return 'Music';
    case 'scene':
      return 'Scene · asks for a second tap';
    case 'action':
      return 'Action · asks for a second tap';
    case 'gap':
      return '';
  }
}

const MISSING_HINT: Record<string, string> = {
  app: 'That app is not on this head unit',
  scene: 'That scene was deleted',
  action: 'That action was deleted',
};

/**
 * A button on the rail, as a row. The name side opens the detail screen (rename, picture); the three square buttons are 48 px each and
 * need no typing. Settings is a fixed row: it says so and has no controls. A button whose target is gone (an app removed, a scene
 * deleted) is listed as Missing with only Remove.
 */
export function NavItemRow({ item, canUp, canDown, onOpen, onUp, onDown, onRemove }: NavItemRowProps) {
  const name = item.label;
  const Icon = item.Icon;

  if (item.fixed) {
    return (
      <li className="ne-row" data-fixed="true">
        <div className="ne-row-main" data-static="true">
          <Icon size={22} className="ne-row-icon" />
          <span className="ne-row-text">
            <b>{name}</b>
            <small>Always shown, always last</small>
          </span>
          <Lock size={18} className="ne-lock" aria-hidden="true" />
        </div>
      </li>
    );
  }

  if (item.state === 'missing') {
    return (
      <li className="ne-row" data-state="missing">
        <div className="ne-row-main" data-static="true">
          <Icon size={22} className="ne-row-icon" />
          <span className="ne-row-text">
            <b>{name}</b>
            <small>{MISSING_HINT[item.to.kind] ?? 'No longer available'}</small>
          </span>
          <Badge tone="warn">Missing</Badge>
        </div>
        <button type="button" className="ne-btn sq" data-tone="danger" aria-label={`Remove ${name} from navigation`} onClick={onRemove}>
          <Trash2 size={20} />
        </button>
      </li>
    );
  }

  return (
    <li className="ne-row" data-state={item.state} data-nav-id={item.id}>
      <button type="button" className="ne-row-main" aria-label={`Edit ${name}`} onClick={onOpen}>
        <Icon size={22} className="ne-row-icon" />
        <span className="ne-row-text">
          <b>{name}</b>
          <small>{hintOf(item)}</small>
        </span>
        <ChevronRight size={18} className="ne-more" aria-hidden="true" />
      </button>
      <button type="button" className="ne-btn sq" aria-label={`Move ${name} up`} disabled={!canUp} onClick={onUp}>
        <ArrowUp size={20} />
      </button>
      <button type="button" className="ne-btn sq" aria-label={`Move ${name} down`} disabled={!canDown} onClick={onDown}>
        <ArrowDown size={20} />
      </button>
      <button type="button" className="ne-btn sq" data-tone="danger" aria-label={`Remove ${name} from navigation`} onClick={onRemove}>
        <Trash2 size={20} />
      </button>
    </li>
  );
}
