import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FM_BAND, FM_MAX_PRESETS, FM_NOTICE_VERSION, NO_FM, type FmState, type FmStatus } from '@headunit/shared';
import {
  acceptNoticeAndSwitchOn,
  cleanLine,
  createTuner,
  fmCalls,
  fmView,
  frequencyText,
  helpFor,
  levelWord,
  nextFrequency,
  presetsView,
  pressSwitch,
  readFmState,
  statusLine,
  switchPress,
  switchView,
  transmitterLine,
  tunerView,
  TUNE_DELAY_MS,
} from './fm';

const STATUSES: FmStatus[] = ['unconfigured', 'unreachable', 'unsupported', 'idle', 'starting', 'transmitting', 'error'];

/** A state as the head unit would send it, with the parts a test cares about changed. */
const state = (over: Partial<FmState> = {}): FmState => ({ ...NO_FM, mode: 'remote', status: 'idle', acknowledged: true, frequency: 100.6, ...over });
const view = (over: Partial<FmState> = {}) => fmView(state(over));
const hostile = (over: Record<string, unknown>) => fmView({ ...state(), ...over } as unknown as FmState);

describe('cleanLine', () => {
  it('turns control characters and line separators into spaces, collapses runs, and trims', () => {
    expect(cleanLine('  a\u0000b\n\tc\u2028d\u2029e\u0085f   g ', 100)).toBe('a b c d e f g');
  });
  it('cuts a long sentence with an ellipsis, to the length asked for', () => {
    const out = cleanLine('x'.repeat(500), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
    expect(cleanLine('short', 20)).toBe('short');
  });
  it('is empty for anything that is not text', () => {
    for (const v of [undefined, null, 5, {}, [], NaN]) expect(cleanLine(v, 20)).toBe('');
  });
});

describe('fmView: the state made safe to draw', () => {
  it('before the first snapshot there is nothing to show or do', () => {
    const v = fmView(undefined);
    expect(v.ready).toBe(false);
    expect(v.frequency).toBeNull();
    expect(v.presets).toEqual([]);
    expect(v.limits).toEqual(FM_BAND);
    expect(fmView(null).ready).toBe(false);
    expect(fmView('x' as never).ready).toBe(false);
  });

  it('passes a good state through, rounded to a tenth', () => {
    const v = view({ on: true, status: 'transmitting', frequency: 100.6000001, presets: [88.1, 99.5], level: 0.4, board: 'Raspberry Pi Zero 2 W', detail: 'On the air.', demo: true });
    expect(v).toMatchObject({ ready: true, mode: 'remote', status: 'transmitting', on: true, acknowledged: true, frequency: 100.6, presets: [88.1, 99.5], level: 0.4, board: 'Raspberry Pi Zero 2 W', detail: 'On the air.', demo: true });
  });

  it('a frequency that is not a number is no frequency (never NaN or Infinity on the dial)', () => {
    for (const f of [NaN, Infinity, -Infinity, null, undefined, '100.6', {}, 5, 5000, -3]) expect(hostile({ frequency: f }).frequency, String(f)).toBeNull();
    expect(frequencyText(hostile({ frequency: NaN }).frequency)).toBe('--.-');
    expect(frequencyText(100.6)).toBe('100.6');
  });

  it('presets: only real frequencies inside the limits, no repeats, at most the maximum, whatever arrives', () => {
    expect(hostile({ presets: undefined }).presets).toEqual([]);
    expect(hostile({ presets: 'nope' }).presets).toEqual([]);
    expect(hostile({ presets: [] }).presets).toEqual([]);
    expect(hostile({ presets: [NaN, null, '88.1', 200, 88.1, 88.14, 99.9] }).presets).toEqual([88.1, 99.9]);
    expect(hostile({ presets: Array.from({ length: 50 }, (_, i) => 88 + i / 10) }).presets).toHaveLength(FM_MAX_PRESETS);
    expect(hostile({ presets: [88.1, 100.6], limits: { min: 88, max: 95 } }).presets).toEqual([88.1]);
  });

  it('limits that make no sense fall back to the broadcast band', () => {
    for (const limits of [undefined, null, {}, { min: NaN, max: 108 }, { min: 108, max: 87.5 }, { min: 87.5, max: 87.5 }, { min: 10, max: 500 }, 'x']) expect(hostile({ limits }).limits, JSON.stringify(limits)).toEqual(FM_BAND);
    expect(hostile({ limits: { min: 88, max: 90 } }).limits).toEqual({ min: 88, max: 90 });
  });

  it('level is held between 0 and 1', () => {
    expect(hostile({ level: 7 }).level).toBe(1);
    expect(hostile({ level: -2 }).level).toBe(0);
    expect(hostile({ level: NaN }).level).toBe(0);
    expect(hostile({ level: 'loud' }).level).toBe(0);
  });

  it('flags are true only when they are true', () => {
    const v = hostile({ on: 'yes', acknowledged: 1, demo: 'true' });
    expect([v.on, v.acknowledged, v.demo]).toEqual([false, false, false]);
  });

  it('a mode or status it does not know becomes "none" and a problem, with a sentence that says what to do', () => {
    expect(hostile({ mode: 'sideways' }).mode).toBe('none');
    const v = hostile({ status: 'melting', detail: 'ignore me' });
    expect(v.status).toBe('error');
    expect(v.detail).toMatch(/Reload the page/);
  });

  it('huge, multi-line or odd detail text becomes one short line', () => {
    const v = hostile({ detail: `${'word '.repeat(400)}\n\u2028end`, board: `${'B'.repeat(900)}\u0000` });
    expect(v.detail.length).toBeLessThanOrEqual(240);
    expect(v.detail).not.toMatch(/[\n\u2028]/);
    expect(v.board!.length).toBeLessThanOrEqual(120);
    expect(hostile({ detail: 42 }).detail).toBe('');
    expect(hostile({ board: '   ' }).board).toBeNull();
  });

  it('never throws, whatever it is given', () => {
    for (const v of [undefined, null, 0, 'x', [], [1], () => 1, { status: {} }, { limits: [] }, { presets: { length: 3 } }]) expect(() => fmView(v as never)).not.toThrow();
  });
});

describe('statusLine: the state in words', () => {
  it('has a label for every status, on or off, and never an empty sentence', () => {
    for (const status of STATUSES) {
      for (const on of [false, true]) {
        const line = statusLine(view({ status, on, detail: '' }));
        expect(line.label.length, `${status} ${on}`).toBeGreaterThan(2);
        expect(line.detail.length, `${status} ${on}`).toBeGreaterThan(10);
      }
    }
  });

  it('uses the head unit’s own sentence when it sent one', () => {
    expect(statusLine(view({ status: 'unreachable', detail: 'Nothing answers at the address.' })).detail).toBe('Nothing answers at the address.');
  });

  it('names the states apart, so the label alone says which it is', () => {
    const label = (status: FmStatus, on = false) => statusLine(view({ status, on })).label;
    expect(label('transmitting', true)).toBe('On the air');
    expect(label('starting', true)).toBe('Starting');
    expect(label('idle', false)).toBe('Off');
    expect(label('idle', true)).toBe('Switching on');
    expect(label('unconfigured')).toBe('Not set up');
    expect(label('unreachable', true)).toBe('Can’t reach the helper');
    expect(label('unsupported')).toBe('Not supported on this Pi');
    expect(label('error', true)).toBe('Problem');
    expect(new Set(STATUSES.map((s) => label(s))).size).toBe(STATUSES.length);
  });

  it('tones: ok on the air, danger for a problem, warn for what needs the person to act', () => {
    const tone = (status: FmStatus) => statusLine(view({ status, on: true })).tone;
    expect(tone('transmitting')).toBe('ok');
    expect(tone('error')).toBe('danger');
    expect([tone('unconfigured'), tone('unreachable'), tone('unsupported')]).toEqual(['warn', 'warn', 'warn']);
    expect(statusLine(view({ status: 'idle', on: false })).tone).toBeUndefined();
  });

  it('before the first snapshot it says it is connecting', () => {
    expect(statusLine(fmView(undefined))).toMatchObject({ kind: 'connecting', label: 'Connecting' });
  });

  it('on the air without a usable frequency still reads sensibly', () => {
    const line = statusLine(hostile({ status: 'transmitting', on: true, frequency: NaN, detail: '' }));
    expect(line.detail).not.toMatch(/NaN|undefined|null|--/);
  });
});

describe('levelWord', () => {
  it('says what the level means in four steps, and treats nonsense as silence', () => {
    expect(levelWord(0)).toBe('No sound');
    expect(levelWord(0.019)).toBe('No sound');
    expect(levelWord(0.02)).toBe('Quiet');
    expect(levelWord(0.099)).toBe('Quiet');
    expect(levelWord(0.1)).toBe('Playing');
    expect(levelWord(0.89)).toBe('Playing');
    expect(levelWord(0.9)).toBe('Very loud');
    expect(levelWord(1)).toBe('Very loud');
    expect(levelWord(NaN)).toBe('No sound');
  });
});

describe('transmitterLine', () => {
  it('says where the transmitter is and what board it reported', () => {
    expect(transmitterLine(view({ mode: 'remote', board: 'Raspberry Pi Zero 2 W' }))).toBe('On a second Pi: Raspberry Pi Zero 2 W');
    expect(transmitterLine(view({ mode: 'local', board: null }))).toBe('On this Pi');
    expect(transmitterLine(view({ mode: 'none', board: null }))).toBeNull();
    expect(transmitterLine(view({ mode: 'none', board: 'Odd board' }))).toBe('Odd board');
  });
});

describe('the dial', () => {
  it('four buttons: 1 MHz and 0.1 MHz down, 0.1 and 1 MHz up, each named for a screen reader', () => {
    const t = tunerView(view(), 100.6);
    expect(t.buttons.map((b) => [b.steps, b.label, b.aria])).toEqual([
      [-10, '−1', 'Down 1 megahertz'],
      [-1, '−0.1', 'Down 0.1 megahertz'],
      [1, '+0.1', 'Up 0.1 megahertz'],
      [10, '+1', 'Up 1 megahertz'],
    ]);
    expect(t.text).toBe('100.6');
    expect(t.buttons.every((b) => !b.disabled)).toBe(true);
  });

  it('a press lands one step away, inside the band, without floating-point crumbs', () => {
    expect(nextFrequency(100.6, 1, FM_BAND)).toBe(100.7);
    expect(nextFrequency(100.6, -10, FM_BAND)).toBe(99.6);
    expect(nextFrequency(88.1, 1, FM_BAND)).toBe(88.2);
    expect(nextFrequency(107.9, 10, FM_BAND)).toBe(108);
    expect(nextFrequency(87.6, -10, FM_BAND)).toBe(87.5);
    expect(nextFrequency(null, 1, FM_BAND)).toBe(88.2);
  });

  it('the buttons that could not move the dial any further are off', () => {
    const low = tunerView(view(), FM_BAND.min).buttons.map((b) => b.disabled);
    expect(low).toEqual([true, true, false, false]);
    const high = tunerView(view(), FM_BAND.max).buttons.map((b) => b.disabled);
    expect(high).toEqual([false, false, true, true]);
    // a whole MHz down from 87.6 still moves the dial (to the end of the band)
    expect(tunerView(view(), 87.6).buttons[0]!.disabled).toBe(false);
  });

  it('follows the limits the helper reported, and says them', () => {
    const v = view({ limits: { min: 88, max: 90 } });
    expect(tunerView(v, 90).buttons.map((b) => b.disabled)).toEqual([false, false, true, true]);
    expect(tunerView(v, 88).range).toBe('This transmitter tunes 88.0 to 90.0 MHz.');
  });

  it('before the first snapshot every button is off, and the dial shows dashes', () => {
    const t = tunerView(fmView(undefined), null);
    expect(t.text).toBe('--.-');
    expect(t.buttons.every((b) => b.disabled)).toBe(true);
  });

  it('with no usable frequency the buttons still work, so a bad value can be walked out of', () => {
    const t = tunerView(hostile({ frequency: NaN }), null);
    expect(t.text).toBe('--.-');
    expect(t.buttons.every((b) => !b.disabled)).toBe(true);
  });
});

describe('saved frequencies', () => {
  it('chips for each, the current one marked, and the button saves or removes', () => {
    const v = view({ presets: [88.1, 100.6] });
    const p = presetsView(v, 100.6);
    expect(p.chips).toEqual([
      { frequency: 88.1, text: '88.1', active: false },
      { frequency: 100.6, text: '100.6', active: true },
    ]);
    expect(p.saved).toBe(true);
    expect(p.disabled).toBe(false);
    expect(presetsView(v, 99.9).saved).toBe(false);
  });

  it('with nothing saved it explains how to', () => {
    const p = presetsView(view({ presets: [] }), 100.6);
    expect(p.chips).toEqual([]);
    expect(p.hint).toMatch(/Save this/);
    expect(p.disabled).toBe(false);
  });

  it('when the maximum are saved a new one cannot be, but a saved one can be removed', () => {
    const full = Array.from({ length: FM_MAX_PRESETS }, (_, i) => 90 + i);
    const v = view({ presets: full });
    const fresh = presetsView(v, 99.5);
    expect(fresh.disabled).toBe(true);
    expect(fresh.hint).toContain(String(FM_MAX_PRESETS));
    const saved = presetsView(v, 90);
    expect(saved.saved).toBe(true);
    expect(saved.disabled).toBe(false);
    expect(saved.hint).toBeNull();
  });

  it('cannot save when there is no frequency, or before the first snapshot', () => {
    expect(presetsView(view(), null).disabled).toBe(true);
    expect(presetsView(fmView(undefined), 100.6).disabled).toBe(true);
  });
});

describe('the switch', () => {
  it('can be switched on once the notice is accepted, and tells what a tap does', () => {
    const idle = view({ status: 'idle', on: false });
    expect(switchPress(idle)).toBe('on');
    expect(switchView(idle)).toMatchObject({ checked: false, disabled: false, stateWord: 'Off', hint: 'Tap to start sending.' });
  });

  it('SAFETY: switching on before the notice is accepted opens the notice and nothing else, in every state that can be switched on', () => {
    for (const status of STATUSES) {
      const v = view({ status, on: false, acknowledged: false });
      const press = switchPress(v);
      expect(press, status).not.toBe('on');
      expect(press, status).toBe(status === 'unconfigured' || status === 'unsupported' ? 'none' : 'notice');
    }
    expect(switchView(view({ on: false, acknowledged: false })).hint).toMatch(/notice/);
  });

  it('with the notice accepted, on is on for every state that can start', () => {
    for (const status of STATUSES.filter((s) => s !== 'unconfigured' && s !== 'unsupported')) expect(switchPress(view({ status, on: false, acknowledged: true })), status).toBe('on');
  });

  it('when it is on, a tap switches it off, in every state, even a broken one', () => {
    for (const status of STATUSES) {
      for (const acknowledged of [false, true]) {
        const v = view({ status, on: true, acknowledged });
        expect(switchPress(v), `${status} ${acknowledged}`).toBe('off');
        expect(switchView(v).checked).toBe(true);
        expect(switchView(v).disabled).toBe(false);
        expect(switchView(v).stateWord).toBe('On');
      }
    }
  });

  it('cannot be switched on when nothing is set up or the Pi is not supported, and says why', () => {
    for (const status of ['unconfigured', 'unsupported'] as const) {
      const v = view({ status, on: false });
      expect(switchPress(v)).toBe('none');
      const s = switchView(v);
      expect(s.disabled).toBe(true);
      expect(s.hint).toMatch(/below/);
    }
    expect(switchView(view({ status: 'unconfigured' })).hint).not.toBe(switchView(view({ status: 'unsupported' })).hint);
  });

  it('before the first snapshot it does nothing', () => {
    const v = fmView(undefined);
    expect(switchPress(v)).toBe('none');
    expect(switchView(v)).toMatchObject({ checked: false, disabled: true, stateWord: 'Off' });
  });

  it('while it is on, the hint says how it is going', () => {
    expect(switchView(view({ status: 'transmitting', on: true })).hint).toBe('Sending on 100.6 MHz. Tap to switch off.');
    expect(switchView(view({ status: 'starting', on: true })).hint).toMatch(/Starting/);
    expect(switchView(view({ status: 'unreachable', on: true })).hint).toMatch(/keeps trying/);
    expect(switchView(hostile({ status: 'transmitting', on: true, frequency: NaN })).hint).not.toMatch(/NaN|--/);
  });
});

describe('pressSwitch: a tap on the switch, carried out', () => {
  const run = async (over: Partial<FmState>) => {
    const power = vi.fn(async (on: boolean) => state({ on }));
    const openNotice = vi.fn();
    const result = await pressSwitch(view(over), { power }, openNotice);
    return { power, openNotice, result };
  };

  it('SAFETY: with the notice not yet accepted, a tap on On opens the notice and sends nothing at all', async () => {
    for (const status of ['idle', 'starting', 'transmitting', 'unreachable', 'error'] as const) {
      const { power, openNotice, result } = await run({ status, on: false, acknowledged: false });
      expect(openNotice, status).toHaveBeenCalledTimes(1);
      expect(power, status).not.toHaveBeenCalled();
      expect(result).toBeNull();
    }
  });

  it('with the notice accepted, a tap on Off-to-On switches on, without showing the notice', async () => {
    const { power, openNotice } = await run({ status: 'idle', on: false, acknowledged: true });
    expect(power).toHaveBeenCalledExactlyOnceWith(true);
    expect(openNotice).not.toHaveBeenCalled();
  });

  it('a tap on a switch that is on switches it off, whether or not the notice is on record', async () => {
    for (const acknowledged of [false, true]) {
      const { power, openNotice } = await run({ status: 'transmitting', on: true, acknowledged });
      expect(power).toHaveBeenCalledExactlyOnceWith(false);
      expect(openNotice).not.toHaveBeenCalled();
    }
  });

  it('a tap on a switch that cannot be used does nothing', async () => {
    for (const status of ['unconfigured', 'unsupported'] as const) {
      const { power, openNotice, result } = await run({ status, on: false, acknowledged: true });
      expect(power).not.toHaveBeenCalled();
      expect(openNotice).not.toHaveBeenCalled();
      expect(result).toBeNull();
    }
    const before = await pressSwitch(fmView(undefined), { power: vi.fn() }, vi.fn());
    expect(before).toBeNull();
  });

  it('hands back the head unit’s answer', async () => {
    const { result } = await run({ status: 'idle', on: false, acknowledged: true });
    expect(result).toMatchObject({ on: true });
  });
});

describe('helpFor: the next step in plain words', () => {
  it('nothing to do while it works, is starting, or is simply off', () => {
    for (const status of ['idle', 'starting', 'transmitting'] as const) expect(helpFor(view({ status })), status).toBeNull();
    expect(helpFor(fmView(undefined))).toBeNull();
  });

  it('not set up: the install command for the second Pi, the two .env lines, and the local alternative', () => {
    const h = helpFor(view({ status: 'unconfigured', mode: 'none' }))!;
    const text = JSON.stringify(h);
    expect(h.kind).toBe('unconfigured');
    expect(text).toContain('sudo ./deploy/setup-fm.sh node');
    expect(text).toContain('FM_NODE_URL=');
    expect(text).toContain('FM_NODE_TOKEN=');
    expect(text).toContain('sudo ./deploy/setup-fm.sh local');
    expect(h.steps.every((s) => s.text.length > 10)).toBe(true);
  });

  it('can’t reach it: what to check, in order, with the status command', () => {
    const h = helpFor(view({ status: 'unreachable' }))!;
    expect(h.kind).toBe('unreachable');
    expect(h.steps.map((s) => s.command).filter(Boolean)).toEqual(['sudo systemctl status headunit-fm-node']);
    expect(JSON.stringify(h)).toMatch(/FM_NODE_URL[\s\S]*FM_NODE_TOKEN/);
  });

  it('not supported: says so and points to a second Pi, naming the board when it is known', () => {
    const local = helpFor(view({ status: 'unsupported', mode: 'local', board: 'Raspberry Pi 5 Model B Rev 1.0' }))!;
    expect(local.intro).toMatch(/this head unit runs on/);
    expect(local.intro).toContain('Raspberry Pi 5 Model B Rev 1.0');
    expect(JSON.stringify(local)).toContain('sudo ./deploy/setup-fm.sh node');
    const remote = helpFor(view({ status: 'unsupported', mode: 'remote', board: null }))!;
    expect(remote.intro).toMatch(/has the FM helper/);
    expect(remote.intro).not.toMatch(/It reports/);
  });

  it('a problem: the usual causes and the log command', () => {
    const h = helpFor(view({ status: 'error' }))!;
    expect(h.kind).toBe('error');
    expect(JSON.stringify(h)).toContain('journalctl -u headunit-fm-node');
  });

  it('never prints a real password: the examples are placeholders', () => {
    for (const status of ['unconfigured', 'unreachable', 'unsupported', 'error'] as const) {
      const text = JSON.stringify(helpFor(view({ status })));
      expect(text, status).not.toMatch(/TOKEN=[a-f0-9]{8,}/i);
    }
    expect(JSON.stringify(helpFor(view({ status: 'unconfigured' })))).toContain('FM_NODE_TOKEN=PASSWORD');
  });
});

describe('readFmState: the head unit’s answer to a change', () => {
  it('is the state, made safe', () => {
    expect(readFmState(state({ on: true, frequency: 99.5 }))).toMatchObject({ on: true, frequency: 99.5, status: 'idle' });
    expect(readFmState({ ...state(), frequency: NaN, presets: 'x', detail: 'a\nb' })).toMatchObject({ frequency: NO_FM.frequency, presets: [], detail: 'a b' });
  });
  it('is null for anything that is not a state (the change may still have worked: the pushed state shows it)', () => {
    for (const v of [undefined, null, 7, 'ok', [], {}, { ok: true }, { status: 5 }]) expect(readFmState(v), JSON.stringify(v)).toBeNull();
  });
});

describe('fmCalls: what is sent to the head unit', () => {
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const stub = (r: Response | Error) => {
    const fn = vi.fn(async () => {
      if (r instanceof Error) throw r;
      return r.clone();
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const sent = (fn: ReturnType<typeof stub>, i = 0) => {
    const [path, init] = fn.mock.calls[i] as unknown as [string, RequestInit];
    return { path, method: init.method, body: JSON.parse(String(init.body)) as unknown };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('tune, power, acknowledge and preset: the paths and bodies the server reads', async () => {
    const fn = stub(answer(200, state()));
    await fmCalls.tune(99.5);
    await fmCalls.power(true);
    await fmCalls.power(false);
    await fmCalls.acknowledge();
    await fmCalls.preset(88.1, true);
    await fmCalls.preset(88.1, false);
    expect([0, 1, 2, 3, 4, 5].map((i) => sent(fn, i))).toEqual([
      { path: '/api/fm/tune', method: 'POST', body: { frequency: 99.5 } },
      { path: '/api/fm/power', method: 'POST', body: { on: true } },
      { path: '/api/fm/power', method: 'POST', body: { on: false } },
      { path: '/api/fm/acknowledge', method: 'POST', body: { version: FM_NOTICE_VERSION } },
      { path: '/api/fm/preset', method: 'POST', body: { frequency: 88.1, saved: true } },
      { path: '/api/fm/preset', method: 'POST', body: { frequency: 88.1, saved: false } },
    ]);
  });

  it('resolves with the new state', async () => {
    stub(answer(200, state({ on: true, status: 'starting' })));
    expect(await fmCalls.power(true)).toMatchObject({ on: true, status: 'starting' });
  });

  it('throws the head unit’s own plain sentence when it refuses', async () => {
    stub(answer(403, { error: 'Read and accept the FM notice before the transmitter is switched on.' }));
    await expect(fmCalls.power(true)).rejects.toThrow('Read and accept the FM notice before the transmitter is switched on.');
    stub(new TypeError('offline'));
    await expect(fmCalls.tune(99.5)).rejects.toThrow('Can’t reach the head unit');
  });
});

describe('acceptNoticeAndSwitchOn: "I understand"', () => {
  const calls = (over: { acknowledge?: () => Promise<FmState | null>; power?: (on: boolean) => Promise<FmState | null> } = {}) => {
    const log: string[] = [];
    return {
      log,
      acknowledge: vi.fn(over.acknowledge ?? (async () => (log.push('acknowledge'), state({ acknowledged: true })))),
      power: vi.fn(over.power ?? (async (on: boolean) => (log.push(`power ${on}`), state({ on })))),
    };
  };

  it('SAFETY: records that the notice was read first, and only then switches on', async () => {
    const c = calls();
    const closed = vi.fn(() => c.log.push('close'));
    await acceptNoticeAndSwitchOn(c, closed);
    expect(c.log).toEqual(['acknowledge', 'close', 'power true']);
    expect(c.acknowledge).toHaveBeenCalledTimes(1);
    expect(c.power).toHaveBeenCalledWith(true);
  });

  it('SAFETY: when recording fails nothing is switched on, and the notice is not reported as done', async () => {
    const c = calls({ acknowledge: async () => Promise.reject(new Error('That is not the current FM notice.')) });
    const closed = vi.fn();
    await expect(acceptNoticeAndSwitchOn(c, closed)).rejects.toThrow('not the current FM notice');
    expect(c.power).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
  });

  it('when switching on fails after the notice was recorded, the notice still counts as done and the reason is thrown', async () => {
    const c = calls({ power: async () => Promise.reject(new Error('The FM transmitter is not set up.')) });
    const closed = vi.fn();
    await expect(acceptNoticeAndSwitchOn(c, closed)).rejects.toThrow('not set up');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('createTuner: a run of taps is sent once', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (send: (f: number) => Promise<unknown> = async () => undefined) => {
    const pending: Array<number | null> = [];
    const errors: unknown[] = [];
    const sendFn = vi.fn(send);
    const tuner = createTuner({ send: sendFn, onPending: (f) => pending.push(f), onError: (e) => errors.push(e) });
    return { tuner, sendFn, pending, errors };
  };

  it('SAFETY: taps in quick succession send only the frequency they end on, once, after a pause', async () => {
    const { tuner, sendFn, pending } = make();
    tuner.set(100.7);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS - 50);
    tuner.set(100.8);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS - 50);
    tuner.set(100.9);
    expect(sendFn).not.toHaveBeenCalled();
    expect(pending).toEqual([100.7, 100.8, 100.9]); // the dial follows every tap at once
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS);
    expect(sendFn.mock.calls.map((c) => c[0])).toEqual([100.9]);
    expect(pending.at(-1)).toBeNull(); // settled: back to what the head unit says
  });

  it('a saved frequency is sent at once, and cancels a step still waiting', async () => {
    const { tuner, sendFn } = make();
    tuner.set(100.7);
    tuner.now(88.1);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS * 2);
    expect(sendFn.mock.calls.map((c) => c[0])).toEqual([88.1]);
  });

  it('a failure goes to onError and the dial goes back', async () => {
    const { tuner, errors, pending } = make(async () => Promise.reject(new Error('Choose a frequency between 87.5 and 108.0 MHz.')));
    tuner.set(110);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toMatch(/Choose a frequency/);
    expect(pending.at(-1)).toBeNull();
  });

  it('a tap while the last one is being sent keeps the dial where the person put it', async () => {
    let release: () => void = () => {};
    const { tuner, pending, sendFn } = make(() => new Promise<void>((r) => (release = r)));
    tuner.set(100.7);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS);
    expect(sendFn).toHaveBeenCalledTimes(1);
    tuner.set(100.8); // while 100.7 is in flight
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(pending.at(-1)).toBe(100.8); // the first one settling must not snap the dial back
    release = () => {};
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS);
    expect(sendFn.mock.calls.map((c) => c[0])).toEqual([100.7, 100.8]);
  });

  it('leaving the page with a tap waiting sends it', async () => {
    const { tuner, sendFn } = make();
    tuner.set(99.5);
    tuner.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendFn.mock.calls.map((c) => c[0])).toEqual([99.5]);
    await vi.advanceTimersByTimeAsync(TUNE_DELAY_MS * 2);
    expect(sendFn).toHaveBeenCalledTimes(1); // and the timer does not send it again
    tuner.flush(); // nothing waiting: nothing sent
    await vi.advanceTimersByTimeAsync(0);
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('a send that throws at once (not a rejected promise) is also reported, not lost', async () => {
    const errors: unknown[] = [];
    const tuner = createTuner({
      send: () => {
        throw new Error('boom');
      },
      onPending: () => {},
      onError: (e) => errors.push(e),
    });
    tuner.now(99.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
  });
});
