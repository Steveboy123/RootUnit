import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAV, NAV_ICONS, NAV_LIMITS, NAV_PRESETS, sanitizeNav, type NavConfig, type NavItem } from '@headunit/shared';
import { APPS } from '../../../apps/registry';
import { resolveNav, type NavContext } from '../../../lib/nav';
import { addItem, applyPreset, setLabel } from '../../../lib/navEdit';
import { NavDetail, nextRadioIndex } from './NavDetail';
import { NavEditorView, type NavEditorViewProps } from './NavEditorView';

// The real lock reads the live speed from the store, which server-side rendering cannot change; the rule itself is lib/driving.ts.
// Here we only check what the editor does with it.
const car = vi.hoisted(() => ({ locked: false }));
vi.mock('../../../lib/driving', () => ({ useTypingLocked: () => car.locked }));

const scene = { id: 'night0001', name: 'Night drive', icon: 'moon', actions: {} } as never;
const action = { id: 'garage0001', name: 'Garage door', icon: 'door', confirm: false } as never;
const ctx: NavContext = { apps: APPS, scenes: [scene], actions: [action] };

const noop = () => {};
function view(config: NavConfig = DEFAULT_NAV, over: Partial<NavEditorViewProps> = {}, withCtx: NavContext = ctx): string {
  return renderToStaticMarkup(
    <NavEditorView
      config={config}
      items={resolveNav(config, withCtx)}
      ctx={withCtx}
      tab="items"
      screen={{ kind: 'main' }}
      fit={null}
      onTab={noop}
      onScreen={noop}
      onChange={noop}
      onRevert={noop}
      onReset={noop}
      onClose={noop}
      {...over}
    />,
  );
}

const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
const nameOf = (b: string) => /aria-label="([^"]*)"/.exec(b)?.[1] ?? b.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim();
const names = (html: string) => buttons(html).map(nameOf);
const find = (html: string, name: string | RegExp) => buttons(html).find((b) => (typeof name === 'string' ? nameOf(b) === name : name.test(nameOf(b))));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const item = (id: string, to: NavItem['to'], extra: Partial<NavItem> = {}): NavItem => ({ id, to, ...extra });

/** Default rail with extra buttons in the head and optionally in the foot. */
function custom(head: NavItem[], foot: NavItem[] = [], over: Partial<NavConfig> = {}): NavConfig {
  return sanitizeNav({ ...DEFAULT_NAV, ...over, items: [...DEFAULT_NAV.items.slice(0, 5), ...head, { id: 'spacer', to: { kind: 'gap' } }, ...foot, DEFAULT_NAV.items.at(-1)!] });
}

beforeEach(() => {
  car.locked = false;
});

describe('NavEditorView: the panel', () => {
  it('is a docked dialog with a name, outside swipe and edge-back handling, with a scrim around it', () => {
    const html = view();
    expect(html).toMatch(/^<div class="ne-scrim" data-no-swipe="true" data-no-edge-back="true">/);
    expect(html).toContain('<div class="ne-panel" role="dialog" aria-modal="true" aria-label="Edit navigation"');
  });

  it('Close and Reset all are always there: on both tabs, offline, and while the car is moving', () => {
    for (const over of [{ tab: 'items' as const }, { tab: 'look' as const }, { offline: true }, { dirty: true }]) {
      const html = view(DEFAULT_NAV, over);
      expect(find(html, 'Close'), JSON.stringify(over)).toBeDefined();
      expect(html, JSON.stringify(over)).toContain('Reset all');
    }
    car.locked = true;
    const locked = view();
    expect(find(locked, 'Close')).toBeDefined();
    expect(locked).toContain('Reset all');
  });

  it('Close is a real, enabled button even while locked or offline', () => {
    car.locked = true;
    expect(find(view(DEFAULT_NAV, { offline: true }), 'Close')).not.toContain('disabled');
  });

  it('Revert is there but off until something has changed', () => {
    expect(find(view(DEFAULT_NAV, { dirty: false }), /Revert/)).toContain('disabled');
    expect(find(view(DEFAULT_NAV, { dirty: true }), /Revert/)).not.toContain('disabled');
  });

  it('Reset all is a confirm button: the first tap arms it, nothing is wired to a single tap', () => {
    expect(find(view(), /Reset all/)).toContain('data-armed="false"');
  });

  it('while the car is moving the body is the lock card (with the passenger button); the header stays, and Revert and Reset are off', () => {
    car.locked = true;
    const html = view(DEFAULT_NAV, { dirty: true });
    expect(html).toContain('Editing navigation is locked while driving');
    expect(find(html, /passenger/)).toBeDefined();
    expect(html).not.toContain('class="ne-list"');
    expect(html).not.toContain('ne-tabs');
    expect(html).toMatch(/<fieldset class="ne-actions" disabled=""/);
  });

  it('with the car parked there is no lock card', () => {
    expect(view()).not.toContain('locked while driving');
    expect(view()).not.toMatch(/<fieldset class="ne-actions" disabled/);
  });

  it('offline: a note says why, and the whole body is a disabled fieldset', () => {
    const html = view(DEFAULT_NAV, { offline: true });
    expect(html).toContain('The head unit cannot be reached');
    expect(html).toMatch(/<fieldset class="ne-fields" disabled=""/);
    expect(html).toMatch(/<fieldset class="ne-actions" disabled=""/);
    expect(view()).not.toContain('cannot be reached');
    expect(view()).not.toMatch(/<fieldset class="ne-fields" disabled/);
  });

  it('every button has a name a person can hear', () => {
    for (const over of [{}, { tab: 'look' as const }, { screen: { kind: 'add' as const } }, { screen: { kind: 'detail' as const, id: 'drive' } }]) {
      for (const b of buttons(view(DEFAULT_NAV, over))) expect(nameOf(b), `${JSON.stringify(over)}: ${b}`).not.toBe('');
    }
  });

  it('has exactly one heading: the title', () => {
    expect(count(view(), /<h2\b/g)).toBe(1);
  });
});

describe('NavEditorView: the Items tab', () => {
  it('has Items | Look tabs (Items selected) and an Add button next to them', () => {
    const html = view();
    expect(html).toMatch(/role="radiogroup" aria-label="Section"/);
    expect(find(html, 'Items')).toContain('aria-checked="true"');
    expect(find(html, 'Look')).toContain('aria-checked="false"');
    expect(find(html, /^Add$/)).toBeDefined();
  });

  it('lists every button in rail order, with the pinned line before the foot and Settings last', () => {
    const html = view(custom([item('gpsx', { kind: 'app', app: 'gps' })], [item('trip', { kind: 'app', app: 'trips' })]));
    const rows = [...html.matchAll(/<li class="ne-row"[^>]*>[\s\S]*?<\/li>/g)].map((m) => /<b>([^<]*)<\/b>/.exec(m[0])?.[1]);
    expect(rows).toEqual(['Home', 'Drive', 'Music', 'Auto', 'Apps', 'GPS', 'Trips', 'Settings']);
    expect(html.indexOf('Apps')).toBeLessThan(html.indexOf('Pinned below'));
    expect(html.indexOf('GPS')).toBeLessThan(html.indexOf('Pinned below'));
    expect(html.indexOf('Pinned below')).toBeLessThan(html.indexOf('<b>Trips</b>'));
    expect(html.indexOf('<b>Trips</b>')).toBeLessThan(html.indexOf('<b>Settings</b>'));
  });

  it('each ordinary row has rename, up, down and remove, each named after the button', () => {
    const html = view();
    for (const name of ['Home', 'Drive', 'Music', 'Auto', 'Apps']) {
      for (const label of [`Edit ${name}`, `Move ${name} up`, `Move ${name} down`, `Remove ${name} from navigation`]) expect(find(html, label), label).toBeDefined();
    }
  });

  it('the first button cannot go up and the last scrolling one steps over the divider (down is allowed)', () => {
    const html = view();
    expect(find(html, 'Move Home up')).toContain('disabled');
    expect(find(html, 'Move Home down')).not.toContain('disabled');
    expect(find(html, 'Move Apps down')).not.toContain('disabled');
  });

  it('with two buttons already pinned, the last scrolling one cannot be pinned too (down is off); the first pinned one can come back up', () => {
    const html = view(custom([], [item('gpsx', { kind: 'app', app: 'gps' }), item('trip', { kind: 'app', app: 'trips' })]));
    expect(find(html, 'Move Apps down')).toContain('disabled');
    expect(find(html, 'Move GPS up')).not.toContain('disabled');
    expect(find(html, 'Move Trips down')).toContain('disabled');
  });

  it('the Settings row is fixed: it says so, and has no remove, no move and no rename', () => {
    const html = view();
    const row = /<li class="ne-row" data-fixed="true">[\s\S]*?<\/li>/.exec(html)![0];
    expect(row).toContain('Settings');
    expect(row).toContain('Always shown, always last');
    expect(row).not.toContain('<button');
    expect(html).not.toMatch(/Remove Settings|Move Settings|Edit Settings/);
    expect(count(html, /data-fixed="true"/g)).toBe(1);
  });

  it('a pinned scene or action says it asks for a second tap; a music tab and an app say what they are', () => {
    const pins = [item('night', { kind: 'scene', scene: 'night0001' }), item('door', { kind: 'action', action: 'garage0001' }), item('radi', { kind: 'music', tab: 'radio' }), item('gpsx', { kind: 'app', app: 'gps' })];
    const html = view(sanitizeNav({ ...DEFAULT_NAV, items: [...pins, DEFAULT_NAV.items[5]!, DEFAULT_NAV.items[6]!] }));
    expect(html).toContain('<b>Night drive</b><small>Scene · asks for a second tap</small>');
    expect(html).toContain('<b>Garage door</b><small>Action · asks for a second tap</small>');
    expect(html).toContain('<b>Radio</b><small>Music</small>');
    expect(html).toContain('<b>GPS</b><small>App</small>');
  });

  it('shows the custom name a person gave a button', () => {
    const named = setLabel(DEFAULT_NAV, 'drive', 'Speed');
    const html = view(named);
    expect(html).toContain('<b>Speed</b>');
    expect(find(html, 'Edit Speed')).toBeDefined();
  });

  it('counts how many of the 8 buttons are used', () => {
    expect(view()).toContain(`5 of ${NAV_LIMITS.items - 2} buttons used`);
  });
});

describe('NavEditorView: Missing rows', () => {
  const lost = custom([item('ghst', { kind: 'app', app: 'ghostapp' }), item('door', { kind: 'action', action: 'gone0001' }), item('scn', { kind: 'scene', scene: 'gone0002' })]);

  it('a button whose app, scene or action is gone is listed as Missing, with Remove and nothing else', () => {
    const html = view(lost);
    expect(count(html, /class="badge" data-tone="warn">Missing</g)).toBe(3);
    expect(count(html, /data-state="missing"/g)).toBe(3);
    for (const name of ['ghostapp', 'Action', 'Scene']) {
      expect(find(html, `Remove ${name} from navigation`), name).toBeDefined();
      expect(find(html, `Move ${name} up`), name).toBeUndefined();
      expect(find(html, `Edit ${name}`), name).toBeUndefined();
    }
    expect(html).toContain('That app is not on this head unit');
    expect(html).toContain('That action was deleted');
    expect(html).toContain('That scene was deleted');
  });

  it('a restored config with a missing action lists it under Missing (the backup kept the pin, the action is not on this unit)', () => {
    const restored = sanitizeNav({ ...DEFAULT_NAV, items: [...DEFAULT_NAV.items.slice(0, 5), { id: 'door', to: { kind: 'action', action: 'lost0001' }, label: 'Garage' }, ...DEFAULT_NAV.items.slice(5)] });
    const html = view(restored, {}, { ...ctx, actions: [] });
    expect(html).toMatch(/<li class="ne-row" data-state="missing">[\s\S]*?<b>Garage<\/b>[\s\S]*?Missing/);
    expect(find(html, 'Remove Garage from navigation')).toBeDefined();
  });

  it('while the scene and action lists have not arrived, nothing is called missing', () => {
    const html = view(lost, {}, { ...ctx, scenes: undefined, actions: undefined });
    expect(count(html, /Missing/g)).toBe(1); // only the app, whose list is always known
    expect(html).toContain('Waiting for the head unit…');
    expect(count(html, /data-state="loading"/g)).toBe(2);
  });

  it('missing buttons count against the 8, so the person is told the truth about room', () => {
    expect(view(lost)).toContain('8 of 8 buttons used');
  });
});

describe('NavEditorView: where the rail starts to scroll on this screen', () => {
  const many = custom([item('gpsx', { kind: 'app', app: 'gps' }), item('trip', { kind: 'app', app: 'trips' }), item('garg', { kind: 'app', app: 'garage' })]);

  it('draws no line while everything fits, or before the rail is measured', () => {
    expect(view(many, { fit: 9 })).not.toContain('scroll on this screen');
    expect(view(many, { fit: null })).not.toContain('scroll on this screen');
  });

  it('draws the line after the last button that fits (the pinned ones and Settings take their places first)', () => {
    const html = view(many, { fit: 7 }); // Settings + 6 scrolling buttons fit; Trips and Garage are past the line
    const order = [...html.matchAll(/<b>([^<]+)<\/b>|scroll on this screen/g)].map((m) => m[1] ?? 'LINE');
    expect(order.indexOf('LINE')).toBe(order.indexOf('GPS') + 1);
    expect(order.indexOf('Trips')).toBeGreaterThan(order.indexOf('LINE'));
  });

  it('with pinned buttons, fewer scrolling ones fit', () => {
    const pinned = custom([item('gpsx', { kind: 'app', app: 'gps' })], [item('trip', { kind: 'app', app: 'trips' })]);
    const html = view(pinned, { fit: 5 }); // 5 = 2 pinned/Settings... Settings + Trips + 3 scrolling
    const order = [...html.matchAll(/<b>([^<]+)<\/b>|scroll on this screen/g)].map((m) => m[1] ?? 'LINE');
    expect(order.indexOf('LINE')).toBe(order.indexOf('Music') + 1);
  });

  it('a button whose app is gone is not on the rail, so it does not use up a place before the line', () => {
    const lost = custom([item('ghst', { kind: 'app', app: 'ghostapp' }), item('gpsx', { kind: 'app', app: 'gps' }), item('trip', { kind: 'app', app: 'trips' })]);
    // 7 places = Settings + 6 scrolling. The 5 pages, GPS and Trips are 7 drawn scrolling buttons (the ghost is not drawn), so Trips is the one over
    const html = view(lost, { fit: 7 });
    const order = [...html.matchAll(/<b>([^<]+)<\/b>|scroll on this screen/g)].map((m) => m[1] ?? 'LINE');
    expect(order.indexOf('LINE')).toBe(order.indexOf('Trips') - 1); // the line sits right before Trips
    expect(view(lost, { fit: 8 })).not.toContain('scroll on this screen');
  });

  it('is one line, in the scrolling part and not in the pinned part', () => {
    const html = view(many, { fit: 6 });
    expect(count(html, /scroll on this screen/g)).toBe(1);
    expect(html.indexOf('scroll on this screen')).toBeLessThan(html.indexOf('Pinned below'));
  });
});

describe('NavEditorView: the Look tab', () => {
  const html = view(DEFAULT_NAV, { tab: 'look' });

  it('has Where (left, bottom, right), Style, Size and Names as plain-language choices', () => {
    for (const name of ['Left', 'Bottom', 'Right', 'Small', 'Medium', 'Large', 'Always', 'Current page', 'Never']) expect(find(html, name), name).toBeDefined();
    expect(count(html, /role="radiogroup"/g)).toBe(5); // the tabs, where, style, size and names
  });

  it('offers all ten navigation styles, each drawn as a small live preview', () => {
    for (const name of ['Classic dock', 'Floating pill', 'Edge rail', 'Minimal icons', 'Glowing curve', '3D glass', 'Split', 'Text tabs', 'Wave', 'Mascot']) expect(html, name).toContain(`<b>${name}</b>`);
    expect(count(html, /class="dock-style"/g)).toBe(10);
    expect(count(html, /class="dock" aria-hidden="true"/g)).toBe(10);
  });

  it('marks the current choice', () => {
    expect(find(html, 'Left')).toContain('aria-checked="true"');
    expect(find(html, 'Medium')).toContain('aria-checked="true"');
    expect(find(html, 'Always')).toContain('aria-checked="true"');
    const right = view({ ...DEFAULT_NAV, position: 'right', size: 'large', labels: 'never' }, { tab: 'look' });
    expect(find(right, 'Right')).toContain('aria-checked="true"');
    expect(find(right, 'Large')).toContain('aria-checked="true"');
    expect(find(right, 'Never')).toContain('aria-checked="true"');
  });

  it('has the three ready-made chips, with the one the rail matches pressed', () => {
    expect(['Default', 'Minimal', 'Driver'].map((n) => find(html, n)).every(Boolean)).toBe(true);
    expect(find(html, 'Default')).toContain('aria-pressed="true"');
    expect(find(html, 'Minimal')).toContain('aria-pressed="false"');
    for (const id of ['minimal', 'driver'] as const) {
      const h = view(applyPreset(DEFAULT_NAV, id), { tab: 'look' });
      expect(find(h, id === 'minimal' ? 'Minimal' : 'Driver'), id).toContain('aria-pressed="true"');
      expect(find(h, 'Default'), id).toContain('aria-pressed="false"');
    }
    expect(NAV_PRESETS.minimal.items).toHaveLength(5);
  });

  it('no chip is pressed for a rail that matches none, and a changed side does not unpress a match', () => {
    const odd = view(addItem(DEFAULT_NAV, { kind: 'app', app: 'gps' }), { tab: 'look' });
    expect(count(odd, /aria-pressed="true"/g)).toBe(0);
    const right = view({ ...DEFAULT_NAV, position: 'right' }, { tab: 'look' });
    expect(find(right, 'Default')).toContain('aria-pressed="true"');
  });

  it('has a Reset the look confirm button, and no Add button (that is the Items tab)', () => {
    expect(find(html, /Reset the look/)).toContain('data-armed="false"');
    expect(find(html, /^Add$/)).toBeUndefined();
    expect(find(html, 'Look')).toContain('aria-checked="true"');
  });
});

describe('NavEditorView: the Add picker', () => {
  const add = (config: NavConfig = DEFAULT_NAV, withCtx: NavContext = ctx) => view(config, { screen: { kind: 'add' } }, withCtx);

  it('replaces the list: Back and Close, the title, and four groups', () => {
    const html = add();
    expect(html).toMatch(/<h2 tabindex="-1">Add a button<\/h2>/);
    expect(find(html, 'Back to the list of buttons')).toBeDefined();
    expect(find(html, 'Close')).toBeDefined();
    expect(html).not.toContain('class="ne-list"');
    const at = ['Apps', 'Music', 'Scenes &amp; actions', 'Pages'].map((group) => html.indexOf(`>${group}</h3>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at); // the three that are mostly new first, the pages (mostly already there) last
  });

  it('offers every app of the launcher by the launcher\'s name, and says when the rail will use a shorter one', () => {
    const html = add();
    for (const a of APPS) expect(html, a.id).toContain(`<b>${a.name.replace(/&/g, '&amp;')}</b>`);
    const findcar = buttons(html).find((b) => b.includes('<b>Find my car</b>'))!;
    expect(findcar).toContain('Shown as “Find car”');
    expect(buttons(html).find((b) => b.includes('<b>Trips</b>'))).toContain('<small>App</small>');
  });

  it('offers the four music sources and the pages (not Settings)', () => {
    const html = add();
    for (const name of ['Spotify', 'TIDAL', 'YT Music', 'Radio', 'Home', 'Drive', 'Music', 'Auto', 'Apps']) expect(html, name).toContain(`<b>${name}</b>`);
    expect(html).not.toContain('<b>Settings</b>');
  });

  it('what is already on the rail is disabled and says so; the rest can be picked', () => {
    const html = add(addItem(DEFAULT_NAV, { kind: 'app', app: 'gps' }));
    for (const name of ['Home', 'Drive', 'Music', 'Auto', 'Apps', 'GPS']) {
      const b = buttons(html).find((x) => x.includes(`<b>${name}</b>`))!;
      expect(b, name).toContain('disabled=""');
      expect(b, name).toContain('Already on the navigation');
    }
    const trips = buttons(html).find((x) => x.includes('<b>Trips</b>'))!;
    expect(trips).not.toContain('disabled');
    expect(trips).toContain('<small>App</small>');
  });

  it('a pinned scene or action is disabled, an unpinned one is not; the second-tap note is there once', () => {
    const html = add(custom([item('night', { kind: 'scene', scene: 'night0001' })]));
    expect(buttons(html).find((x) => x.includes('<b>Night drive</b>'))).toContain('disabled=""');
    expect(buttons(html).find((x) => x.includes('<b>Garage door</b>'))).not.toContain('disabled');
    expect(count(html, /ask for a second tap/g)).toBe(1);
  });

  it('a music tab can be pinned beside the Music page (a different button), and once pinned it is disabled', () => {
    const html = add(custom([item('radi', { kind: 'music', tab: 'radio' })]));
    expect(buttons(html).find((x) => x.includes('<b>Radio</b>'))).toContain('disabled=""');
    expect(buttons(html).find((x) => x.includes('<b>Spotify</b>'))).not.toContain('disabled');
    expect(buttons(html).find((x) => x.includes('<b>Music</b>'))).toContain('disabled=""'); // the page, already there
  });

  it('when the rail is full everything is disabled and a note says why', () => {
    const full = custom([item('gpsx', { kind: 'app', app: 'gps' }), item('trip', { kind: 'app', app: 'trips' }), item('garg', { kind: 'app', app: 'garage' })]);
    expect(full.items).toHaveLength(NAV_LIMITS.items);
    const html = add(full);
    expect(html).toContain('Navigation is full');
    const picks = buttons(html).filter((b) => b.includes('class="ne-pick"'));
    expect(picks.length).toBeGreaterThan(20);
    for (const b of picks) expect(b, nameOf(b)).toContain('disabled=""');
    // not full: no note
    expect(add()).not.toContain('Navigation is full');
  });

  it('scenes and actions that have not arrived yet are waited for, not offered', () => {
    const html = add(DEFAULT_NAV, { ...ctx, scenes: undefined, actions: undefined });
    expect(html).toContain('Waiting for the head unit…');
    expect(html).not.toContain('Night drive');
  });

  it('with no scenes and no actions, it says where to make some', () => {
    expect(add(DEFAULT_NAV, { ...ctx, scenes: [], actions: [] })).toContain('You have no scenes or actions yet');
  });
});

describe('NavEditorView: one button\'s detail screen', () => {
  const detail = (id: string, config: NavConfig = DEFAULT_NAV) => view(config, { screen: { kind: 'detail', id } });

  it('has the name field (10 characters at most, the usual name as the hint), a live counter, the picture grid and Remove', () => {
    const html = detail('drive');
    expect(html).toMatch(/<h2 tabindex="-1">Drive<\/h2>/);
    expect(html).toMatch(/<input[^>]* maxLength="10"|<input[^>]* maxlength="10"/i);
    expect(html).toContain('placeholder="Drive"');
    expect(html).toContain('>0/10<');
    expect(find(html, /Remove from navigation/)).toBeDefined();
    expect(find(html, 'Back to the list of buttons')).toBeDefined();
    expect(find(html, 'Close')).toBeDefined();
  });

  it('shows what is typed and counts it by characters (an emoji is one)', () => {
    const named = setLabel(DEFAULT_NAV, 'drive', 'Fast \u{1F697}');
    const html = detail('drive', named);
    expect(html).toContain('value="Fast \u{1F697}"');
    expect(html).toContain('>6/10<');
    expect(html).toMatch(/<h2 tabindex="-1">Fast \u{1F697}<\/h2>/u);
    expect(html).toContain('placeholder="Drive"');
  });

  it('has every picture of the vocabulary as a 48px radio with a name, plus the usual one, and marks the current one', () => {
    const html = detail('drive', { ...DEFAULT_NAV, items: DEFAULT_NAV.items.map((i) => (i.id === 'drive' ? { ...i, icon: 'star' as const } : i)) });
    const radios = buttons(html).filter((b) => b.includes('class="ne-cell"'));
    expect(radios).toHaveLength(NAV_ICONS.length + 1);
    for (const b of radios) expect(b).toMatch(/role="radio"/);
    for (const id of NAV_ICONS) expect(find(html, id.replace(/-/g, ' ')), id).toBeDefined();
    expect(find(html, 'star')).toContain('aria-checked="true"');
    expect(find(html, /^Usual picture/)).toContain('aria-checked="false"');
    expect(radios.filter((b) => b.includes('aria-checked="true"'))).toHaveLength(1);
  });

  it('the pictures are ONE tab stop (the chosen one), not 43, and the arrow keys move between them', () => {
    const html = detail('drive', { ...DEFAULT_NAV, items: DEFAULT_NAV.items.map((i) => (i.id === 'drive' ? { ...i, icon: 'star' as const } : i)) });
    const radios = buttons(html).filter((b) => b.includes('class="ne-cell"'));
    expect(radios.filter((b) => b.includes('tabindex="0"'))).toHaveLength(1);
    expect(find(html, 'star')).toContain('tabindex="0"');
    expect(radios.filter((b) => b.includes('tabindex="-1"'))).toHaveLength(NAV_ICONS.length);
    // with no picture of its own the usual one is the stop
    expect(find(detail('drive'), /^Usual picture/)).toContain('tabindex="0"');
  });

  it('nextRadioIndex: right and down go on, left and up go back, both wrap, Home and End jump, other keys are left alone', () => {
    expect([nextRadioIndex(5, 0, 'ArrowRight'), nextRadioIndex(5, 4, 'ArrowRight'), nextRadioIndex(5, 4, 'ArrowDown')]).toEqual([1, 0, 0]);
    expect([nextRadioIndex(5, 2, 'ArrowLeft'), nextRadioIndex(5, 0, 'ArrowLeft'), nextRadioIndex(5, 0, 'ArrowUp')]).toEqual([1, 4, 4]);
    expect([nextRadioIndex(5, 3, 'Home'), nextRadioIndex(5, 1, 'End')]).toEqual([0, 4]);
    expect([nextRadioIndex(5, 1, 'a'), nextRadioIndex(5, 1, 'Enter'), nextRadioIndex(0, 0, 'ArrowRight')]).toEqual([null, null, null]);
  });

  it('with no picture of its own, the usual one is the checked one, and it says what it is', () => {
    const html = detail('drive');
    expect(find(html, 'Usual picture (Drive)')).toContain('aria-checked="true"');
    expect(buttons(html).filter((b) => b.includes('class="ne-cell"') && b.includes('aria-checked="true"'))).toHaveLength(1);
  });

  it('is only for a button that can be edited: Settings, the divider, a missing one and an unknown id fall back to the list', () => {
    const lost = custom([item('ghst', { kind: 'app', app: 'ghostapp' })]);
    for (const [id, config] of [['settings', DEFAULT_NAV], ['spacer', DEFAULT_NAV], ['nope', DEFAULT_NAV], ['ghst', lost]] as const) {
      const html = detail(id, config);
      expect(html, id).toContain('class="ne-list"');
      expect(html, id).not.toContain('Name on the button');
    }
  });

  it('a pinned app shows its usual short name as the hint', () => {
    const html = detail('findc', custom([item('findc', { kind: 'app', app: 'findcar' })]));
    expect(html).toContain('placeholder="Find car"');
  });

  it('the header has no Reset or Revert here (there is room for the title, and the keyboard needs the height)', () => {
    const html = detail('drive');
    expect(html).not.toContain('Reset all');
    expect(html).not.toContain('Revert');
  });
});
