/** Once per browser, a short tip that the navigation can be changed: the hold gesture has no sign on screen, so nothing else would say. */
export const NAV_HINT_KEY = 'hu.navHintShown';
/** The tip comes up this long after the interface is ready, so it is not on top of the first thing a person looks at. */
export const NAV_HINT_DELAY_MS = 8000;
export const NAV_HINT_TEXT = 'Tip: press and hold any button on the navigation to change it';

export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * True the first time it is asked on this browser, and never again. With no usable storage (a private window, blocked site data) it is
 * always false: a tip that could not be remembered would come back on every start.
 */
export function takeNavHint(storage: HintStorage | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(NAV_HINT_KEY) !== null) return false;
    storage.setItem(NAV_HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** The browser's storage if it will give it out (reading `localStorage` itself can throw). */
export function browserHintStorage(): HintStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
