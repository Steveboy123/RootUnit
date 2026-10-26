import { useEffect } from 'react';
import { useHeadUnit } from '../store';

type Action = 'next' | 'prev' | 'toggle';

const editable = (el: EventTarget | null) => {
  const node = el instanceof HTMLElement ? el : null;
  return Boolean(node?.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'));
};

function knobItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-knob-item]')).filter((el) => {
    if (el.matches(':disabled,[aria-disabled="true"]')) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 2 && r.height > 2;
  });
}

function browse(delta: -1 | 1): boolean {
  const items = knobItems();
  if (!items.length) return false;
  let i = items.findIndex((el) => el.dataset.knobSelected === 'true' || el === document.activeElement);
  if (i < 0) {
    // Start with the row closest to the vertical centre of the visible content, rather than jumping to a row far above the viewport.
    const cy = innerHeight / 2;
    i = items.reduce((best, el, n) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - cy);
      return d < best.d ? { d, n } : best;
    }, { d: Number.POSITIVE_INFINITY, n: delta > 0 ? -1 : 0 }).n;
  }
  const n = (i + delta + items.length) % items.length;
  for (const el of items) delete el.dataset.knobSelected;
  const next = items[n]!;
  next.dataset.knobSelected = 'true';
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

function activateSelected(): boolean {
  const selected = knobItems().find((el) => el.dataset.knobSelected === 'true');
  if (!selected) return false;
  selected.click();
  delete selected.dataset.knobSelected;
  return true;
}

function transport(action: Action) {
  const s = useHeadUnit.getState();
  if (s.radio?.playing) {
    s.radio_cmd({ cmd: action === 'toggle' ? 'toggle' : action });
    return;
  }
  if (s.localNowPlaying) {
    s.localMedia_cmd(action);
    return;
  }
  const bt = s.devices?.media;
  if (bt && (bt.status === 'playing' || bt.status === 'paused') && (bt.title || bt.artist)) {
    s.device_cmd({ cmd: 'media', action });
    return;
  }
  s.media_cmd({ cmd: action });
}

/**
 * USB multimedia/volume knob integration.
 * Normal volume and mute remain native OS keys. Long-turn media keys browse visible music rows;
 * press activates the highlighted row, or toggles play/pause when no row is selected. When there is no
 * visible list, long-turn media keys become previous/next.
 */
export function HardwareController() {
  useEffect(() => {
    let lastAction: Action | null = null;
    let lastAt = 0;
    const perform = (action: Action, allowBrowse = true) => {
      const now = Date.now();
      // The same HID event can arrive through evdev and Chromium. Collapse that duplicate only.
      if (action === lastAction && now - lastAt < 80) return;
      lastAction = action;
      lastAt = now;
      if (allowBrowse && action !== 'toggle' && browse(action === 'next' ? 1 : -1)) return;
      // Car-style rotary behaviour: after rotating through a visible music list, pressing the knob
      // activates the highlighted row. With no highlighted row the press remains play/pause.
      if (action === 'toggle' && activateSelected()) return;
      transport(action);
    };

    const onHardware = (event: Event) => {
      const action = (event as CustomEvent<{ action?: Action }>).detail?.action;
      if (action === 'next' || action === 'prev' || action === 'toggle') perform(action, action !== 'toggle');
    };

    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      const key = e.key;
      const mediaNext = key === 'MediaTrackNext';
      const mediaPrev = key === 'MediaTrackPrevious';
      const comboToggle = e.ctrlKey && e.altKey && key.toLowerCase() === 'n';
      const comboNext = e.ctrlKey && (key === 'ArrowRight');
      const comboPrev = e.ctrlKey && (key === 'ArrowLeft');
      // Mode 3 sends bare arrows. Only steal those when a browseable music list is actually visible.
      const plainNext = !e.ctrlKey && !e.altKey && !e.metaKey && key === 'ArrowRight' && knobItems().length > 0;
      const plainPrev = !e.ctrlKey && !e.altKey && !e.metaKey && key === 'ArrowLeft' && knobItems().length > 0;
      if (!(mediaNext || mediaPrev || comboToggle || comboNext || comboPrev || plainNext || plainPrev)) return;
      e.preventDefault();
      e.stopPropagation();
      if (comboToggle) perform('toggle', false);
      else perform(mediaPrev || comboPrev || plainPrev ? 'prev' : 'next', true);
    };

    window.addEventListener('headunit:hardware-control', onHardware);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('headunit:hardware-control', onHardware);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
  return null;
}
