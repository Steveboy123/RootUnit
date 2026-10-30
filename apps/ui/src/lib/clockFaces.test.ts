import { describe, expect, it } from 'vitest';
import { WORD_GRID, binaryColumns, wordClockCells, wordClockSentence, wordClockWords } from './clockFaces';

describe('word clock', () => {
  it('spells out the time to the last five minutes', () => {
    expect(wordClockSentence(10, 0)).toBe("IT IS TEN O'CLOCK");
    expect(wordClockSentence(10, 4)).toBe("IT IS TEN O'CLOCK");
    expect(wordClockSentence(10, 5)).toBe('IT IS FIVE PAST TEN');
    expect(wordClockSentence(10, 17)).toBe('IT IS A QUARTER PAST TEN');
    expect(wordClockSentence(10, 29)).toBe('IT IS TWENTY FIVE PAST TEN');
    expect(wordClockSentence(10, 30)).toBe('IT IS HALF PAST TEN');
    expect(wordClockSentence(10, 35)).toBe('IT IS TWENTY FIVE TO ELEVEN');
    expect(wordClockSentence(10, 45)).toBe('IT IS A QUARTER TO ELEVEN');
    expect(wordClockSentence(10, 59)).toBe('IT IS FIVE TO ELEVEN');
  });

  it('runs on a twelve-hour face through midnight and noon', () => {
    expect(wordClockSentence(0, 0)).toBe("IT IS TWELVE O'CLOCK");
    expect(wordClockSentence(12, 10)).toBe('IT IS TEN PAST TWELVE');
    expect(wordClockSentence(23, 50)).toBe('IT IS TEN TO TWELVE');
    expect(wordClockSentence(11, 40)).toBe('IT IS TWENTY TO TWELVE');
    expect(wordClockSentence(13, 0)).toBe("IT IS ONE O'CLOCK");
  });

  it('lights exactly the letters of those words on the grid', () => {
    for (let h = 0; h < 24; h++)
      for (let m = 0; m < 60; m += 5) {
        const cells = wordClockCells(h, m);
        const letters = [...cells].map((k) => {
          const [r, c] = k.split(':').map(Number);
          return WORD_GRID[r!]![c!];
        });
        const spelled = wordClockWords(h, m).map((w) => (w === 'OCLOCK' ? 'OCLOCK' : w.replace(/_[MH]$/, ''))).join('');
        expect(letters.length, `${h}:${m}`).toBe(spelled.length);
      }
    // Spot check the grid itself: "QUARTER" really is where the clock lights it.
    expect([...wordClockCells(3, 15)].filter((k) => k.startsWith('1:')).map((k) => WORD_GRID[1][Number(k.split(':')[1])]).join('')).toBe('AQUARTER');
  });

  it('has a grid of ten rows of eleven letters', () => {
    expect(WORD_GRID).toHaveLength(10);
    for (const row of WORD_GRID) expect(row).toHaveLength(11);
  });
});

describe('binary clock', () => {
  it('codes each digit of the time in binary, top bit first', () => {
    const cols = binaryColumns(23, 59, 7);
    expect(cols.map((c) => c.length)).toEqual([2, 4, 3, 4, 3, 4]);
    expect(cols[0]).toEqual([true, false]); // 2
    expect(cols[1]).toEqual([false, false, true, true]); // 3
    expect(cols[2]).toEqual([true, false, true]); // 5
    expect(cols[3]).toEqual([true, false, false, true]); // 9
    expect(cols[4]).toEqual([false, false, false]); // 0
    expect(cols[5]).toEqual([false, true, true, true]); // 7
  });
});
