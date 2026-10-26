import { useState, type KeyboardEvent } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { NAV_ICONS, NAV_LIMITS, type NavIcon } from '@headunit/shared';
import { NAV_ICON_MAP, type ResolvedNavItem } from '../../../lib/nav';
import { TextField } from '../../../components/ui';
import type { TargetInfo } from './describe';

export interface NavDetailProps {
  item: ResolvedNavItem;
  /** What the button is called and drawn as with nothing of its own: the placeholder, and the picture of "Usual". */
  usual: TargetInfo;
  onLabel(text: string): void;
  onIcon(icon: NavIcon | null): void;
  onRemove(): void;
}

/** Enter on the on-screen keyboard means "done": let go of the field so the keyboard goes away and the whole screen is visible again. */
function doneOnEnter(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key === 'Enter' && e.target instanceof HTMLElement) e.target.blur();
}

const spoken = (id: string) => id.replace(/-/g, ' ');

/**
 * Where an arrow key moves in a group of `count` radio buttons (Home and End jump to the ends, and it wraps), or null for a key that
 * is not one. The pictures are one radio group with ONE tab stop (the chosen one), so a keyboard does not have to tab through all 43.
 */
export function nextRadioIndex(count: number, from: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (from + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (from - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** An arrow key in the pictures: move to the next one and choose it, as a radio group does. */
function arrowInPictures(e: KeyboardEvent<HTMLDivElement>) {
  const cells = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const from = cells.indexOf(e.target as HTMLElement);
  const to = from < 0 ? null : nextRadioIndex(cells.length, from, e.key);
  if (to === null) return;
  e.preventDefault();
  cells[to]?.focus();
  cells[to]?.click();
}

/**
 * The drill-in screen for one button: its name, its picture, Remove. It is its own screen (not a field inside a list row) so that the
 * on-screen keyboard, which takes the lower half of a 1280x400 display, has room: the field sits at the top and the pictures scroll
 * underneath. The field keeps what was typed itself and reports it as it goes; it shows the cleaned-up name again when you leave it.
 */
export function NavDetail({ item, usual, onLabel, onIcon, onRemove }: NavDetailProps) {
  const [text, setText] = useState(item.customLabel ?? '');
  const length = Array.from(text).length;
  const Usual = usual.Icon;

  return (
    <div className="ne-detail">
      <div className="ne-name" onKeyDown={doneOnEnter} onBlur={() => setText(item.customLabel ?? '')}>
        <TextField
          label="Name on the button"
          value={text}
          maxLength={NAV_LIMITS.label}
          placeholder={usual.label}
          className="ne-field"
          onChange={(v) => {
            // The on-screen keyboard types straight into the field and ignores maxLength, so cut it here: what is shown is what the button says.
            const kept = Array.from(v).slice(0, NAV_LIMITS.label).join('');
            setText(kept);
            onLabel(kept);
          }}
        />
        <span className="ne-count" aria-live="polite" data-full={length >= NAV_LIMITS.label || undefined}>
          {length}/{NAV_LIMITS.label}
        </span>
      </div>
      <p className="ne-hint">Leave it empty to use the usual name, {usual.label}.</p>

      <h3 className="ne-h">Picture</h3>
      <div className="ne-icons" role="radiogroup" aria-label="Picture" onKeyDown={arrowInPictures}>
        <button type="button" role="radio" className="ne-cell" tabIndex={item.iconId === null ? 0 : -1} aria-checked={item.iconId === null} aria-label={`Usual picture (${usual.label})`} data-on={item.iconId === null} onClick={() => onIcon(null)}>
          <Usual size={24} />
          <RotateCcw size={12} className="ne-cell-mark" aria-hidden="true" />
        </button>
        {NAV_ICONS.map((id) => {
          const Icon = NAV_ICON_MAP.get(id);
          return (
            <button key={id} type="button" role="radio" className="ne-cell" tabIndex={item.iconId === id ? 0 : -1} aria-checked={item.iconId === id} aria-label={spoken(id)} data-on={item.iconId === id} onClick={() => onIcon(id)}>
              {Icon && <Icon size={24} />}
            </button>
          );
        })}
      </div>

      <button type="button" className="ne-btn wide" data-tone="danger" onClick={onRemove}>
        <Trash2 size={18} />
        Remove from navigation
      </button>
    </div>
  );
}
