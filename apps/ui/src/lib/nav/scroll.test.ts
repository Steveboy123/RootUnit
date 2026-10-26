import { describe, expect, it } from 'vitest';
import { edgeFade, revealOffset, scrollToReveal, stripFade } from '../../components/TabStrip';
import { railFade } from './scroll';

describe('railFade: which ends of the rail head have buttons behind them', () => {
  it('fades nothing when every button fits', () => {
    expect(railFade(0, 400, 400)).toEqual({ top: false, bottom: false });
    expect(railFade(0, 400, 401)).toEqual({ top: false, bottom: false }); // a sub-pixel is not overflow
  });
  it('fades the bottom at the start, both in the middle, only the top at the end', () => {
    expect(railFade(0, 400, 520)).toEqual({ top: false, bottom: true });
    expect(railFade(60, 400, 520)).toEqual({ top: true, bottom: true });
    expect(railFade(119, 400, 520)).toEqual({ top: true, bottom: false });
    expect(railFade(120, 400, 520)).toEqual({ top: true, bottom: false });
  });
});

describe('the horizontal tab strip still works through the shared maths', () => {
  it('stripFade is edgeFade (start/end)', () => {
    const cases: Array<[number, number, number]> = [[0, 424, 424], [0, 424, 463], [20, 424, 463], [39, 424, 463]];
    for (const [pos, client, size] of cases) expect(stripFade(pos, client, size)).toEqual(edgeFade(pos, client, size));
  });
  it('scrollToReveal keeps its rounding and its floor at 0', () => {
    expect(scrollToReveal({ scrollLeft: 0, stripLeft: 100, stripRight: 524, tabLeft: 458, tabRight: 545 })).toBe(21);
    expect(scrollToReveal({ scrollLeft: 5, stripLeft: 100, stripRight: 524, tabLeft: 50, tabRight: 150 })).toBe(0);
    expect(scrollToReveal({ scrollLeft: 5, stripLeft: 100, stripRight: 524, tabLeft: 110, tabRight: 200 })).toBe(5);
  });
});

describe('revealOffset on the rail (the vertical axis): keep the current page in view', () => {
  const view = { from: 0, to: 400 };
  it('stays put when the button is inside', () => {
    expect(revealOffset({ scroll: 30, ...view, itemFrom: 100, itemTo: 164 })).toBe(30);
  });
  it('scrolls down for a button below the visible part', () => {
    expect(revealOffset({ scroll: 0, ...view, itemFrom: 380, itemTo: 444 })).toBe(44);
  });
  it('scrolls up for a button above it, never below 0', () => {
    expect(revealOffset({ scroll: 100, ...view, itemFrom: -30, itemTo: 34 })).toBe(70);
    expect(revealOffset({ scroll: 10, ...view, itemFrom: -50, itemTo: 14 })).toBe(0);
  });
  it('an inset keeps the button clear of the fade: it is brought 24px further in', () => {
    expect(revealOffset({ scroll: 0, ...view, itemFrom: 330, itemTo: 394, inset: 24 })).toBe(18);
    expect(revealOffset({ scroll: 100, ...view, itemFrom: 10, itemTo: 74, inset: 24 })).toBe(86);
    expect(revealOffset({ scroll: 100, ...view, itemFrom: 30, itemTo: 94, inset: 24 })).toBe(100);
  });
});
