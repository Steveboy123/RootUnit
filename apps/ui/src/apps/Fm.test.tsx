import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { FM_MAX_PRESETS, FM_NOTICE_POINTS, NO_FM, type FmState, type FmStatus } from '@headunit/shared';
import { useHeadUnit } from '../store';
import { APPS, appById } from './registry';
import { FmApp } from './Fm';

// No DOM in these tests: the page is drawn to HTML from a made-up store and the markup is read. zustand 5 draws the store's INITIAL state
// when rendering to a string, so the tests write into that object and put it back before each test.
const INITIAL = { ...useHeadUnit.getInitialState() };
const put = (fm: unknown, over: Record<string, unknown> = {}) => Object.assign(useHeadUnit.getInitialState(), { svc: fm === undefined ? {} : { fm }, ...over });

const STATUSES: FmStatus[] = ['unconfigured', 'unreachable', 'unsupported', 'idle', 'starting', 'transmitting', 'error'];
const state = (over: Partial<FmState> = {}): FmState => ({ ...NO_FM, mode: 'remote', status: 'idle', acknowledged: true, frequency: 100.6, presets: [88.1, 99.5], limits: { min: 87.5, max: 108 }, detail: 'A plain sentence.', ...over });
const page = (fm: unknown, over: Record<string, unknown> = {}) => (put(fm, over), renderToStaticMarkup(<FmApp />));
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const attr = (html: string, tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

/** The name a screen reader gives a button: its aria-label, or else its text. */
const names = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].map((m) => /aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? text(m[2]!));

beforeEach(() => {
  Object.assign(useHeadUnit.getInitialState(), INITIAL);
});

describe('FM transmitter app: in the launcher', () => {
  it('is registered in Car Lab with a short name for the rail and a component loaded on first open', () => {
    const app = appById('fm')!;
    expect(app).toMatchObject({ id: 'fm', name: 'FM transmitter', short: 'FM', group: 'Car Lab', description: 'Play the head unit’s sound on a car radio' });
    expect(app.Component).toBeDefined();
    expect(app.route).toBeUndefined();
    expect(app.parkedOnly).toBeUndefined(); // tuning is like the volume: not locked while driving
    expect(APPS.filter((a) => a.id === 'fm')).toHaveLength(1);
  });
});

describe('FM transmitter app: before the first snapshot', () => {
  it('shows a calm, disabled page: connecting, dashes, nothing to press', () => {
    const html = page(undefined);
    const t = text(html);
    expect(t).toContain('Connecting');
    expect(t).toContain('--.- MHz');
    expect(t).toContain('Waiting for the head unit.');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*aria-disabled="true"/);
    const steps = [...html.matchAll(/<button\b([^>]*class="fm-step"[^>]*)>/g)].map((m) => /\bdisabled\b/.test(m[1]!));
    expect(steps).toEqual([true, true, true, true]);
    expect(html).not.toContain('What to do next');
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('How it works and the rules');
    expect(t).not.toMatch(/NaN|undefined|null|\[object/);
  });
});

describe('FM transmitter app: every state', () => {
  const combos = STATUSES.flatMap((status) => [false, true].flatMap((on) => [false, true].map((acknowledged) => ({ status, on, acknowledged }))));

  it('draws for every status, on or off, notice accepted or not, without ever printing a broken value', () => {
    expect(combos).toHaveLength(28);
    for (const c of combos) {
      const html = page(state(c));
      const label = `${c.status} on=${c.on} ack=${c.acknowledged}`;
      expect(text(html), label).not.toMatch(/NaN|undefined|null|\[object|Infinity/);
      expect(text(html), label).toContain('100.6 MHz');
      // one switch, and it says what the head unit says
      expect(html.match(/role="switch"/g), label).toHaveLength(1);
      expect(attr(html, 'button', 'aria-checked'), label).toBe(String(c.on));
      // one status announcement, politely
      expect(html.match(/class="fm-status"/g), label).toHaveLength(1);
      expect(html, label).toMatch(/role="status"[^>]*aria-live="polite"/);
      // the sound meter only while it is on the air
      expect(html.includes('role="meter"'), label).toBe(c.status === 'transmitting');
      // help only where the person has something to do
      expect(html.includes('What to do next'), label).toBe(['unconfigured', 'unreachable', 'unsupported', 'error'].includes(c.status));
      // the notice is never open on its own
      expect(html, label).not.toContain('role="dialog"');
      expect(html, label).not.toContain('Before you switch it on');
      // the dial and the saved frequencies are always there
      expect(html.match(/class="fm-step"/g), label).toHaveLength(4);
      expect(html.match(/class="fm-chip"/g), label).toHaveLength(2);
    }
  });

  it('the switch cannot be switched on only when nothing is set up or the Pi is not supported (and can always be switched off)', () => {
    for (const c of combos) {
      const html = page(state(c));
      const blocked = !c.on && (c.status === 'unconfigured' || c.status === 'unsupported');
      expect(attr(html, 'button', 'aria-disabled'), `${c.status} ${c.on}`).toBe(String(blocked));
    }
  });

  it('SAFETY: a person who has not accepted the notice is told they will be asked, on any state that can start', () => {
    for (const status of ['idle', 'starting', 'unreachable', 'error'] as const) {
      expect(text(page(state({ status, on: false, acknowledged: false }))).toLowerCase()).toContain('read a short notice');
      expect(text(page(state({ status, on: false, acknowledged: true }))).toLowerCase()).not.toContain('read a short notice');
    }
  });

  it('on the air: the dial, the label, the sentence, a level and where the transmitter is', () => {
    const html = page(state({ status: 'transmitting', on: true, level: 0.5, detail: 'Sending on 100.6.', board: 'Raspberry Pi Zero 2 W Rev 1.0' }));
    const t = text(html);
    expect(t).toContain('On the air Sending on 100.6.');
    expect(t).toContain('Playing');
    expect(t).toContain('On a second Pi: Raspberry Pi Zero 2 W Rev 1.0');
    expect(html).toContain('aria-valuenow="0.5"');
    expect(html).toContain('scaleX(0.5)');
    expect(t).toContain('Sending on 100.6 MHz. Tap to switch off.');
  });

  it('setup help: the exact next step for each state that needs one', () => {
    expect(text(page(state({ status: 'unconfigured', mode: 'none' })))).toContain('sudo ./deploy/setup-fm.sh node');
    expect(text(page(state({ status: 'unconfigured', mode: 'none' })))).toContain('FM_NODE_TOKEN=PASSWORD');
    expect(text(page(state({ status: 'unreachable', on: true })))).toContain('sudo systemctl status headunit-fm-node');
    expect(text(page(state({ status: 'unsupported', mode: 'local', board: 'Raspberry Pi 5 Model B Rev 1.0' })))).toContain('Raspberry Pi 5 Model B Rev 1.0');
    expect(text(page(state({ status: 'error', on: true, detail: 'The FM helper refused the password.' })))).toContain('journalctl -u headunit-fm-node');
    for (const status of ['idle', 'starting', 'transmitting'] as const) expect(page(state({ status, on: true })), status).not.toContain('What to do next');
  });

  it('the current frequency is marked among the saved ones, and its button offers to remove it', () => {
    const html = page(state({ frequency: 99.5 }));
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Tune to 99.5 megahertz"/);
    expect(names(html)).toContain('Remove 99.5 megahertz from the saved frequencies');
    expect(names(page(state({ frequency: 100.6 })))).toContain('Save this frequency, 100.6 megahertz');
  });

  it('every button on the page has a name a screen reader can say', () => {
    for (const c of [state(), state({ status: 'unconfigured', mode: 'none' }), state({ status: 'transmitting', on: true }), state({ status: 'error', on: true })]) {
      const html = page(c);
      const all = names(html);
      expect(all.length).toBeGreaterThan(6);
      for (const n of all) expect(n.length, JSON.stringify(all)).toBeGreaterThan(1);
    }
  });

  it('the only inline styles are positions and levels: the meter’s transform, the dial’s needle, marks and spectrum, and the grid', () => {
    const html = page(state({ status: 'transmitting', on: true, level: 0.3 }));
    const styles = [...html.matchAll(/ style="([^"]*)"/g)].map((m) => m[1]!);
    expect(styles).toContain('transform:scaleX(0.3)');
    expect(styles.some((s) => s.startsWith('--pos:'))).toBe(true);
    for (const s of styles) expect(s).toMatch(/^(transform:scaleX\([\d.]+\)|--pos:[\d.]+|--lvl:[\d.]+|--h:[\d.]+;--i:\d+|left:[\d.]+%|display:grid;.*)$/);
  });
});

describe('FM transmitter app: odd values', () => {
  it('a frequency that is NaN shows dashes, and the buttons stay usable', () => {
    const html = page(state({ frequency: NaN }));
    expect(text(html)).toContain('--.- MHz');
    expect(text(html)).not.toMatch(/NaN/);
    const steps = [...html.matchAll(/<button\b([^>]*class="fm-step"[^>]*)>/g)].map((m) => /\bdisabled\b/.test(m[1]!));
    expect(steps).toEqual([false, false, false, false]);
    expect(names(html).filter((n) => /--/.test(n))).toEqual([]);
    expect(names(html)).toContain('Save this frequency');
    expect(/<button\b[^>]*class="btn fm-save"[^>]*\bdisabled\b/.test(html)).toBe(true);
  });

  it('empty or junk saved frequencies: no chips, a hint, no crash', () => {
    for (const presets of [[], undefined, null, 'x', [NaN, 'a', null], { length: 2 }]) {
      const html = page({ ...state(), presets });
      expect(html.includes('class="fm-chip"'), JSON.stringify(presets)).toBe(false);
      expect(text(html)).toContain('Nothing saved yet');
    }
  });

  it('a full list of saved frequencies says why a new one cannot be added', () => {
    const presets = Array.from({ length: FM_MAX_PRESETS }, (_, i) => 90 + i);
    const html = page(state({ presets, frequency: 99.9 }));
    expect(text(html)).toContain(`You can keep ${FM_MAX_PRESETS}.`);
    expect(/<button\b[^>]*class="btn fm-save"[^>]*\bdisabled\b/.test(html)).toBe(true);
  });

  it('a huge detail text is cut to one short line', () => {
    const html = page(state({ status: 'error', on: true, detail: `${'Something went very wrong. '.repeat(200)}\n\u2028` }));
    const detail = /<span class="fm-status-text"><b>Problem<\/b><span>(.*?)<\/span>/.exec(html)![1]!;
    expect(detail.length).toBeLessThanOrEqual(240);
    expect(detail.endsWith('…')).toBe(true);
    expect(html).not.toContain('\u2028');
  });

  it('text from the head unit is text, never markup', () => {
    const html = page(state({ status: 'error', on: true, detail: '<img src=x onerror=alert(1)>', board: '<script>alert(1)</script>' }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('an unknown status is shown as a problem with a way forward, not a blank', () => {
    const html = page({ ...state(), status: 'melting' });
    expect(text(html)).toContain('Problem');
    expect(text(html)).toContain('Reload the page');
  });

  it('a level that is not a number draws as silence', () => {
    const html = page({ ...state({ status: 'transmitting', on: true }), level: NaN });
    expect(html).toContain('scaleX(0)');
    expect(text(html)).toContain('No sound');
  });

  it('limits that make no sense fall back to the broadcast band', () => {
    expect(text(page({ ...state(), limits: { min: 500, max: -3 } }))).toContain('This transmitter tunes 87.5 to 108.0 MHz.');
  });

  it('the narrower band the helper reports is the one shown', () => {
    expect(text(page(state({ limits: { min: 88, max: 90 }, frequency: 90, presets: [] })))).toContain('This transmitter tunes 88.0 to 90.0 MHz.');
  });

  it('never throws, whatever the store holds', () => {
    for (const fm of [null, 0, 'x', [], {}, { status: [] }, { presets: { length: 1e9 } }, { frequency: 'abc', limits: [] }]) expect(() => page(fm), JSON.stringify(fm)).not.toThrow();
  });
});

describe('FM transmitter app: demo', () => {
  it('carries the DEMO tag and says nothing is sent', () => {
    const html = page(state({ demo: true, status: 'transmitting', on: true, mode: 'local', board: 'Demo (no radio)' }));
    expect(html).toMatch(/<span class="badge" data-tone="warn"[^>]*>DEMO<\/span>/);
    expect(text(html)).toContain('This is a demonstration. Nothing is sent over the air.');
    expect(text(html)).toContain('On this Pi: Demo (no radio)');
  });
  it('and a real one carries neither', () => {
    const html = page(state());
    expect(html).not.toContain('>DEMO<');
    expect(text(html)).not.toContain('demonstration');
  });
});

describe('FM transmitter app: the rules are on the page', () => {
  it('holds every point of the notice, closed until asked for', () => {
    const html = page(state());
    expect(html).toContain('<details class="fm-rules">');
    for (const p of FM_NOTICE_POINTS) expect(html).toContain(p.replace(/'/g, '&#x27;'));
  });
});
