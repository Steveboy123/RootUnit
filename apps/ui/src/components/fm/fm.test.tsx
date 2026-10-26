import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FM_NOTICE_POINTS, NO_FM, type FmState } from '@headunit/shared';
import { fmView, helpFor, presetsView, statusLine, switchView, tunerView } from '../../lib/fm';
import { FmNotice } from './Notice';
import { PowerSwitch } from './PowerSwitch';
import { Presets } from './Presets';
import { Rules } from './Rules';
import { SetupHelp } from './SetupHelp';
import { LevelMeter, StatusLine } from './StatusLine';
import { Tuner } from './Tuner';

// No DOM in these tests. The components with no hooks (Tuner, Presets, PowerSwitch) are also called as plain functions and their
// buttons pressed by walking the element tree, which is how "a press does what it says" is checked; the rest are drawn to HTML and read.

const state = (over: Partial<FmState> = {}): FmState => ({ ...NO_FM, mode: 'remote', status: 'idle', acknowledged: true, frequency: 100.6, ...over });
const view = (over: Partial<FmState> = {}) => fmView(state(over));
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

type Props = Record<string, unknown> & { children?: ReactNode };
/** Every element in a tree of plain elements (no components are called), in document order. */
function walk(node: ReactNode, out: Array<ReactElement<Props>> = []): Array<ReactElement<Props>> {
  if (Array.isArray(node)) node.forEach((n) => walk(n as ReactNode, out));
  else if (isValidElement<Props>(node)) {
    out.push(node);
    walk(node.props.children, out);
  }
  return out;
}
const buttons = (node: ReactNode) => walk(node).filter((e) => e.type === 'button');
const labelOf = (e: ReactElement<Props>) => String(e.props['aria-label'] ?? '');

describe('Tuner', () => {
  const tv = (shown = 100.6, over: Partial<FmState> = {}) => tunerView(view(over), shown);

  it('the frequency in a live region with its unit, four named buttons, and the range', () => {
    const html = renderToStaticMarkup(<Tuner view={tv()} pending={false} onStep={() => {}} />);
    expect(html).toMatch(/<output[^>]*aria-live="polite"[^>]*>/);
    expect(text(html.slice(html.indexOf('<output'), html.indexOf('</output>')))).toBe('100.6 MHz');
    expect([...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual(['Tune the frequency', 'Down 1 megahertz', 'Down 0.1 megahertz', 'Up 0.1 megahertz', 'Up 1 megahertz']);
    expect(html).toContain('This transmitter tunes 87.5 to 108.0 MHz.');
    expect(html).toContain('role="group"');
  });

  it('pressing each button reports the step it stands for', () => {
    const onStep = vi.fn();
    const bs = buttons(Tuner({ view: tv(), pending: false, onStep }));
    expect(bs).toHaveLength(4);
    for (const b of bs) (b.props.onClick as () => void)();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([-10, -1, 1, 10]);
  });

  it('at the end of the band the buttons that cannot move are disabled', () => {
    const html = renderToStaticMarkup(<Tuner view={tv(108)} pending={false} onStep={() => {}} />);
    const attrs = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => /\bdisabled\b/.test(m[1]!));
    expect(attrs).toEqual([false, false, true, true]);
  });

  it('the two 0.1 buttons are marked as the main ones; the dial says when a change is still on its way', () => {
    const html = renderToStaticMarkup(<Tuner view={tv()} pending onStep={() => {}} />);
    expect([...html.matchAll(/data-main="(true|false)"/g)].map((m) => m[1])).toEqual(['false', 'true', 'true', 'false']);
    expect(html).toContain('data-pending="true"');
    expect(renderToStaticMarkup(<Tuner view={tv()} pending={false} onStep={() => {}} />)).toContain('data-pending="false"');
  });

  it('shows dashes, not NaN, for a frequency it does not have', () => {
    const html = renderToStaticMarkup(<Tuner view={tunerView(fmView(undefined), null)} pending={false} onStep={() => {}} />);
    expect(text(html)).toContain('--.- MHz');
    expect(html).not.toMatch(/NaN|undefined/);
  });
});

describe('Presets', () => {
  const pv = (presets: number[], shown: number | null = 100.6) => presetsView(view({ presets }), shown);
  const props = (over: Partial<Parameters<typeof Presets>[0]> = {}) => ({ view: pv([88.1, 100.6]), current: '100.6' as string | null, busy: false, onTune: vi.fn(), onToggle: vi.fn(), ...over });

  it('a chip for each saved frequency, the one on the dial pressed, each named for a screen reader', () => {
    const html = renderToStaticMarkup(<Presets {...props()} />);
    expect(html).toContain('aria-label="Saved frequencies"');
    expect([...html.matchAll(/<button\b[^>]*class="fm-chip"[^>]*aria-pressed="(true|false)"[^>]*aria-label="([^"]*)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['false', 'Tune to 88.1 megahertz'],
      ['true', 'Tune to 100.6 megahertz'],
    ]);
  });

  it('tapping a chip tunes to it; the button saves or removes the current one', () => {
    const p = props();
    const bs = buttons(Presets(p));
    (bs[0]!.props.onClick as () => void)();
    expect(p.onTune).toHaveBeenCalledWith(88.1);
    const save = bs.at(-1)!;
    (save.props.onClick as () => void)();
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    expect(labelOf(save)).toBe('Remove 100.6 megahertz from the saved frequencies');
    const fresh = buttons(Presets(props({ view: pv([88.1], 99.5), current: '99.5' }))).at(-1)!;
    expect(labelOf(fresh)).toBe('Save this frequency, 99.5 megahertz');
    expect(labelOf(buttons(Presets(props({ view: pv([], null), current: null }))).at(-1)!)).toBe('Save this frequency'); // never "Save --.- megahertz"
  });

  it('with nothing saved there are no chips (and no empty group), and the hint says how to save', () => {
    const html = renderToStaticMarkup(<Presets {...props({ view: pv([]) })} />);
    expect(html).not.toContain('fm-chips');
    expect(text(html)).toContain('Save this');
    expect(text(html)).toMatch(/Nothing saved yet/);
  });

  it('the button is off while busy, when the list is full, and with no frequency', () => {
    const off = (h: string) => /<button\b[^>]*class="btn fm-save"[^>]*\bdisabled\b/.test(h);
    expect(off(renderToStaticMarkup(<Presets {...props({ busy: true })} />))).toBe(true);
    expect(off(renderToStaticMarkup(<Presets {...props({ view: pv([90, 91, 92, 93, 94, 95], 99.5), current: '99.5' })} />))).toBe(true);
    expect(off(renderToStaticMarkup(<Presets {...props({ view: pv([], null), current: null })} />))).toBe(true);
    expect(off(renderToStaticMarkup(<Presets {...props()} />))).toBe(false);
  });
});

describe('PowerSwitch', () => {
  const sv = (over: Partial<FmState> = {}) => switchView(view(over));

  it('is a switch with a name, a state in words, and the hint tied to it', () => {
    const html = renderToStaticMarkup(<PowerSwitch view={sv({ status: 'idle', on: false })} busy={false} onPress={() => {}} />);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(text(html)).toContain('Send sound to the car radio');
    expect(text(html)).toContain('Off');
    expect(text(html)).toContain('Tap to start sending.');
    const described = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<p class="fm-hint" id="${described}">`);
  });

  it('on: checked, and the word says On (never colour alone)', () => {
    const html = renderToStaticMarkup(<PowerSwitch view={sv({ status: 'transmitting', on: true })} busy={false} onPress={() => {}} />);
    expect(html).toMatch(/aria-checked="true"/);
    expect(html).toContain('data-on="true"');
    expect(text(html)).toContain('On');
  });

  it('a tap presses; while busy, or when it cannot be switched on, a tap does nothing', () => {
    const press = (view: ReturnType<typeof sv>, busy = false) => {
      const onPress = vi.fn();
      (buttons(PowerSwitch({ view, busy, onPress }))[0]!.props.onClick as () => void)();
      return onPress;
    };
    expect(press(sv({ status: 'idle', on: false }))).toHaveBeenCalledTimes(1);
    expect(press(sv({ status: 'transmitting', on: true }))).toHaveBeenCalledTimes(1);
    expect(press(sv({ status: 'idle', on: false }), true)).not.toHaveBeenCalled();
    expect(press(sv({ status: 'unconfigured', on: false }))).not.toHaveBeenCalled();
    expect(press(sv({ status: 'unsupported', on: false }))).not.toHaveBeenCalled();
  });

  it('when it cannot be switched on it is aria-disabled, not disabled (so the reason stays reachable)', () => {
    const html = renderToStaticMarkup(<PowerSwitch view={sv({ status: 'unconfigured', on: false })} busy={false} onPress={() => {}} />);
    expect(html).toMatch(/aria-disabled="true"/);
    expect(html).toContain('data-unavailable="true"');
    expect(/<button\b[^>]*\sdisabled(=|\s|>)/.test(html)).toBe(false);
    expect(text(html)).toContain('Set up the FM helper first');
    const ok = renderToStaticMarkup(<PowerSwitch view={sv({ status: 'idle', on: false })} busy={false} onPress={() => {}} />);
    expect(ok).toMatch(/aria-disabled="false"/);
    expect(ok).toContain('data-unavailable="false"');
  });
});

describe('StatusLine and LevelMeter', () => {
  const line = (over: Partial<FmState>) => statusLine(view(over));

  it('a status region that politely announces the label and the head unit’s sentence', () => {
    const html = renderToStaticMarkup(<StatusLine line={line({ status: 'unreachable', on: true, detail: 'Nothing answers at 192.168.1.9.' })} />);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(text(html)).toBe('Can’t reach the helper Nothing answers at 192.168.1.9.');
    expect(html).toContain('data-tone="warn"');
  });

  it('every state has a different icon, hidden from screen readers, so no state rests on colour', () => {
    const icon = (over: Partial<FmState>) => /<span class="fm-status-icon"[^>]*>(.*?)<\/span>/.exec(renderToStaticMarkup(<StatusLine line={line(over)} />))![1]!;
    const shapes = [
      icon({ status: 'transmitting', on: true }),
      icon({ status: 'starting', on: true }),
      icon({ status: 'idle', on: false }),
      icon({ status: 'unconfigured' }),
      icon({ status: 'unreachable' }),
      icon({ status: 'unsupported' }),
      icon({ status: 'error' }),
    ];
    expect(new Set(shapes.map((s) => s.replace(/class="[^"]*"/g, ''))).size).toBe(shapes.length);
    expect(renderToStaticMarkup(<StatusLine line={line({ status: 'idle' })} />)).toContain('aria-hidden="true"');
  });

  it('the starting and connecting icons turn; the others stand still', () => {
    expect(renderToStaticMarkup(<StatusLine line={line({ status: 'starting', on: true })} />)).toContain('spin');
    expect(renderToStaticMarkup(<StatusLine line={statusLine(fmView(undefined))} />)).toContain('spin');
    expect(renderToStaticMarkup(<StatusLine line={line({ status: 'error' })} />)).not.toContain('spin');
  });

  it('the level meter is a 0 to 1 meter, scaled with a transform, with a word beside it', () => {
    const html = renderToStaticMarkup(<LevelMeter level={0.4} />);
    expect(html).toMatch(/role="meter"[^>]*aria-valuemin="0"[^>]*aria-valuemax="1"[^>]*aria-valuenow="0.4"[^>]*aria-valuetext="Playing"/);
    expect(html).toContain('style="transform:scaleX(0.4)"');
    expect(html).not.toMatch(/width:/);
    expect(text(html)).toBe('Playing');
    expect(text(renderToStaticMarkup(<LevelMeter level={0} />))).toBe('No sound');
    expect(renderToStaticMarkup(<LevelMeter level={1} />)).toContain('scaleX(1)');
  });
});

describe('SetupHelp and Rules', () => {
  it('help: a title, the steps in order, each command in its own box, and where the guide is', () => {
    const help = helpFor(view({ status: 'unconfigured', mode: 'none' }))!;
    const html = renderToStaticMarkup(<SetupHelp help={help} />);
    expect(html).toContain('Set up the transmitter');
    expect(html).toContain('<ol');
    expect([...html.matchAll(/<code class="fm-cmd">(.*?)<\/code>/gs)].map((m) => m[1])).toContain('sudo ./deploy/setup-fm.sh node');
    expect(html).toContain('FM_NODE_URL=http://ADDRESS:8788\nFM_NODE_TOKEN=PASSWORD');
    expect(html).toContain('docs/fm.md');
    expect((html.match(/<li>/g) ?? []).length).toBe(help.steps.length);
  });

  it('help for a problem is drawn as one: tone danger', () => {
    expect(renderToStaticMarkup(<SetupHelp help={helpFor(view({ status: 'error' }))!} />)).toContain('data-tone="danger"');
    expect(renderToStaticMarkup(<SetupHelp help={helpFor(view({ status: 'unreachable' }))!} />)).toContain('data-tone="warn"');
  });

  it('rules: closed until asked, and holding every point of the notice, the aerial and the delay', () => {
    const html = renderToStaticMarkup(<Rules />);
    expect(html).toMatch(/^<details class="fm-rules">/);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('How it works and the rules');
    for (const p of FM_NOTICE_POINTS) expect(html, p).toContain(esc(p));
    expect(text(html)).toMatch(/plain wire, 20 to 40 cm long/);
    expect(text(html)).toMatch(/GPIO4 \(pin 7\)/);
    expect(text(html)).toMatch(/GPIO21 \(pin 40\)/);
    expect(text(html)).toMatch(/one to two seconds late/);
    expect(text(html)).toMatch(/mono/);
  });
});

describe('FmNotice', () => {
  const html = (busy = false) => renderToStaticMarkup(<FmNotice busy={busy} onAccept={() => {}} onCancel={() => {}} />);

  it('is a dialog with a name, and shows every point of the notice word for word', () => {
    const h = html();
    expect(h).toContain('role="dialog" aria-label="Before you switch it on"');
    for (const p of FM_NOTICE_POINTS) expect(h, p).toContain(esc(p));
  });

  it('has a way out and a way in, and the way in is worded as the person’s own act', () => {
    const h = html();
    const bs = [...h.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]!));
    expect(bs).toEqual(['', 'Not now', 'I understand']); // the first is the ✕ of the sheet, named by aria-label
    expect(h).toContain('aria-label="Close"');
    expect(text(h)).toContain('Tapping “I understand” saves that you have read this, and switches the transmitter on.');
  });

  it('SAFETY: nothing in it is already accepted, and "I understand" is not the first thing focus can land on', () => {
    const h = html();
    expect(h).not.toMatch(/autofocus|autoFocus/);
    expect(h.indexOf('>Not now<')).toBeLessThan(h.indexOf('>I understand<')); // the way out comes before the way in
    // focus moves to the first line of the text (tabindex -1), so the notice is read before any button is reached
    expect(h).toMatch(/<p class="fm-lead" tabindex="-1">Please read this/);
  });

  it('while it is working both buttons are off', () => {
    const h = html(true);
    const off = [...h.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].filter((m) => /Not now|I understand/.test(m[2]!)).map((m) => /\bdisabled\b/.test(m[1]!));
    expect(off).toEqual([true, true]);
    expect([...html().matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].filter((m) => /Not now|I understand/.test(m[2]!)).map((m) => /\bdisabled\b/.test(m[1]!))).toEqual([false, false]);
  });
});
