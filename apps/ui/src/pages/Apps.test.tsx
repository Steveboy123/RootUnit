import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NAV, DEFAULT_SETTINGS, type Settings } from '@headunit/shared';
import { APPS, APP_GROUPS } from '../apps/registry';
import { useHeadUnit } from '../store';
import { AppsPage } from './Apps';

// zustand 5 renders the store's initial state when drawing to a string, so the test writes into that (and puts it back).
const INITIAL = { ...useHeadUnit.getInitialState() };
const put = (patch: Partial<typeof INITIAL>) => Object.assign(useHeadUnit.getInitialState(), patch);
beforeEach(() => {
  Object.assign(useHeadUnit.getInitialState(), INITIAL);
});

const withHidden = (hidden: string[]): Settings => ({ ...DEFAULT_SETTINGS, launcher: { version: 1, hidden } });
const page = () => renderToStaticMarkup(<AppsPage />);
const tiles = (html: string) => [...html.matchAll(/<button[^>]*class="card app-tile"[^>]*>.*?<b[^>]*>(.*?)<\/b>/g)].map((m) => m[1]);
const heading = (group: string) => `<div class="section-title">${group}</div>`;
const names = (...ids: string[]) => ids.map((id) => APPS.find((a) => a.id === id)!.name);
/** Garage has an overdue service: the "1 overdue" danger badge. */
const overdueGarage = { garage: { due: [{ status: 'overdue' }] } } as never;

describe('Apps launcher: hidden apps', () => {
  it('draws every app, grouped, when nothing is hidden, and has no Hidden button', () => {
    put({ settings: withHidden([]) });
    const html = page();
    expect(tiles(html)).toHaveLength(APPS.length);
    expect(html).not.toContain('apps-hidden-chip');
    expect(html).not.toContain('data-hidden');
    for (const g of APP_GROUPS) expect(html).toContain(heading(g));
  });

  it('does not draw a hidden app, and says how many are hidden on a 48px Hidden button', () => {
    put({ settings: withHidden(['notes', 'weather']) });
    const html = page();
    expect(tiles(html)).toHaveLength(APPS.length - 2);
    for (const n of names('notes', 'weather')) expect(tiles(html)).not.toContain(n);
    expect(html).toMatch(/<button type="button" class="chip apps-hidden-chip"[^>]*aria-pressed="false"[^>]*>.*?Hidden \((<!-- -->)?2(<!-- -->)?\)/);
  });

  it('an app that needs a look stays on screen even when hidden, and still counts as hidden', () => {
    put({ settings: withHidden(['garage', 'notes']), svc: overdueGarage });
    const html = page();
    expect(tiles(html)).toContain('Garage');
    expect(tiles(html)).not.toContain('Notes');
    expect(html).toContain('1 overdue');
    expect(html).toMatch(/Hidden \((<!-- -->)?2(<!-- -->)?\)/);
    expect(html).not.toContain('data-hidden'); // it is there because it needs a look, not because the Hidden switch is on
  });

  it('without that warning the same app is hidden', () => {
    put({ settings: withHidden(['garage']), svc: {} });
    expect(tiles(page())).not.toContain('Garage');
  });

  it('a group with nothing left to show has no heading', () => {
    put({ settings: withHidden(['arcade']) });
    const html = page();
    expect(html).not.toContain(heading('Play'));
    expect(html).toContain(heading('Car'));
  });

  it('an id that is not an app (from a newer build) hides nothing and does not make a Hidden button', () => {
    put({ settings: withHidden(['from-a-newer-build']) });
    const html = page();
    expect(tiles(html)).toHaveLength(APPS.length);
    expect(html).not.toContain('apps-hidden-chip');
  });

  it('with every app hidden the page says so, and the Hidden button is there to undo it', () => {
        put({ settings: withHidden(APPS.map((a) => a.id)) });
    const html = page();
    expect(tiles(html)).toHaveLength(0);
    expect(html).toContain('Every app is hidden');
    expect(html).toContain('apps-hidden-chip');
  });

  it('every tile is a plain button (a tap opens the app) with no edit mode anywhere on the page', () => {
    put({ settings: withHidden([]) });
    const html = page();
    expect(html.match(/<button[^>]*class="card app-tile"/g)).toHaveLength(APPS.length);
    expect(html.toLowerCase()).not.toContain('edit');
  });

  it('works before the first snapshot has arrived (no settings yet): everything is drawn', () => {
    put({ settings: null });
    expect(tiles(page())).toHaveLength(APPS.length);
  });
});

describe('Apps launcher: which apps are on the navigation', () => {
  it('marks only the tiles of apps that are on it, and the mark is named', () => {
    const nav = { ...DEFAULT_NAV, items: [...DEFAULT_NAV.items.slice(0, 5), { id: 'gpsx', to: { kind: 'app' as const, app: 'gps' } }, ...DEFAULT_NAV.items.slice(5)] };
    put({ settings: { ...DEFAULT_SETTINGS, nav } });
    const html = page();
    expect(html.match(/app-nav-mark/g)).toHaveLength(1);
    expect(html).toContain('role="img" aria-label="On the navigation"');
    const gps = html.match(/<button[^>]*class="card app-tile"[^>]*data-nav="true"[^>]*>.*?<b[^>]*>(.*?)<\/b>/);
    expect(gps?.[1]).toBe(names('gps')[0]);
  });

  it('with the navigation as it came, no tile is marked', () => {
    put({ settings: { ...DEFAULT_SETTINGS } });
    expect(page()).not.toContain('app-nav-mark');
  });
});
