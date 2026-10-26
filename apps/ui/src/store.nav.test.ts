import { DEFAULT_NAV, DEFAULT_SETTINGS } from '@headunit/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apply, useHeadUnit } from './store';

const INITIAL = { ...useHeadUnit.getInitialState() };
const toast = vi.fn();
beforeEach(() => {
  toast.mockClear();
  useHeadUnit.setState({ ...INITIAL, settings: { ...DEFAULT_SETTINGS }, conn: 'open', showToast: toast });
});
afterEach(() => useHeadUnit.setState({ ...INITIAL }));

const snapshot = (settings: unknown) =>
  ({ t: 'snapshot', settings, layout: { version: 1, pages: [{ id: 'p', name: 'P', widgets: [] }] }, vehicle: null, media: { provider: 'spotify' }, system: null, projection: null, androidAutoDev: null, devices: null, radio: { playing: false }, camera: null, diagnostics: null, svc: {} }) as never;

describe('settings that arrive from the server', () => {
  it('a snapshot from a server that predates the navigation settings still gives a complete Settings (the defaults for the missing parts)', () => {
    const { nav, launcher, panel, ...old } = DEFAULT_SETTINGS;
    void nav; void launcher; void panel;
    apply(snapshot(old));
    const s = useHeadUnit.getState().settings!;
    expect(s.nav).toEqual(DEFAULT_NAV);
    expect(s.launcher.hidden).toEqual([]);
    expect(s.panel.tiles.length).toBeGreaterThan(0);
  });

  it('counts snapshots, so a screen can wait for the first one after a reconnect', () => {
    const before = useHeadUnit.getState().snapshots;
    apply(snapshot(DEFAULT_SETTINGS));
    apply(snapshot(DEFAULT_SETTINGS));
    expect(useHeadUnit.getState().snapshots).toBe(before + 2);
  });

  it('a settings message is cleaned the same way', () => {
    apply({ t: 'settings', data: { ...DEFAULT_SETTINGS, nav: 'garbage' } } as never);
    expect(useHeadUnit.getState().settings!.nav).toEqual(DEFAULT_NAV);
  });
});

describe('changing the arrangement while the head unit is unreachable', () => {
  it('is refused with a plain message (it would look applied, then quietly revert on reconnect)', () => {
    useHeadUnit.setState({ conn: 'closed' });
    useHeadUnit.getState().patchSettings({ nav: { version: 1, size: 'large' } });
    expect(useHeadUnit.getState().settings!.nav.size).toBe('regular');
    expect(toast).toHaveBeenCalledWith('Reconnect to the head unit to change this');
    useHeadUnit.getState().patchSettings({ panel: { version: 1, tiles: [] } });
    useHeadUnit.getState().patchSettings({ launcher: { version: 1, hidden: ['notes'] } });
    expect(toast).toHaveBeenCalledTimes(3);
  });

  it('applies the change while connected', () => {
    useHeadUnit.getState().patchSettings({ nav: { version: 1, size: 'large' } });
    expect(useHeadUnit.getState().settings!.nav.size).toBe('large');
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not get in the way of ordinary settings while offline', () => {
    useHeadUnit.setState({ conn: 'closed' });
    useHeadUnit.getState().patchSettings({ units: 'imperial' });
    expect(useHeadUnit.getState().settings!.units).toBe('imperial');
    expect(toast).not.toHaveBeenCalled();
  });
});
