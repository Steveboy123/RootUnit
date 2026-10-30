/**
 * The two standby clocks that need working out: the word clock (the time to the last five minutes, spelled out on a fixed grid of
 * letters) and the binary clock (each digit of the time as lit dots). Pure, so they are tested on their own.
 */

/** The letter grid, eleven by ten, as on the classic word clocks. Unused letters are filler and never light. */
export const WORD_GRID = ['ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'] as const;

/** Where each word sits: row, first column, length. */
const WORDS = {
  IT: [0, 0, 2],
  IS: [0, 3, 2],
  A: [1, 0, 1],
  QUARTER: [1, 2, 7],
  TWENTY: [2, 0, 6],
  FIVE_M: [2, 6, 4],
  HALF: [3, 0, 4],
  TEN_M: [3, 5, 3],
  TO: [3, 9, 2],
  PAST: [4, 0, 4],
  NINE: [4, 7, 4],
  ONE: [5, 0, 3],
  SIX: [5, 3, 3],
  THREE: [5, 6, 5],
  FOUR: [6, 0, 4],
  FIVE_H: [6, 4, 4],
  TWO: [6, 8, 3],
  EIGHT: [7, 0, 5],
  ELEVEN: [7, 5, 6],
  SEVEN: [8, 0, 5],
  TWELVE: [8, 5, 6],
  TEN_H: [9, 0, 3],
  OCLOCK: [9, 5, 6],
} as const satisfies Record<string, readonly [number, number, number]>;
export type WordId = keyof typeof WORDS;

const HOURS: readonly WordId[] = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE_H', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN_H', 'ELEVEN'];

/** The words that light for a time (to the last five minutes): "IT IS TWENTY FIVE PAST TEN". */
export function wordClockWords(hours: number, minutes: number): WordId[] {
  const m5 = Math.floor((((minutes % 60) + 60) % 60) / 5) * 5;
  const hour = HOURS[(((hours % 12) + 12 + (m5 > 30 ? 1 : 0)) % 12)]!;
  const lead: Record<number, WordId[]> = {
    0: [],
    5: ['FIVE_M', 'PAST'],
    10: ['TEN_M', 'PAST'],
    15: ['A', 'QUARTER', 'PAST'],
    20: ['TWENTY', 'PAST'],
    25: ['TWENTY', 'FIVE_M', 'PAST'],
    30: ['HALF', 'PAST'],
    35: ['TWENTY', 'FIVE_M', 'TO'],
    40: ['TWENTY', 'TO'],
    45: ['A', 'QUARTER', 'TO'],
    50: ['TEN_M', 'TO'],
    55: ['FIVE_M', 'TO'],
  };
  return ['IT', 'IS', ...lead[m5]!, hour, ...(m5 === 0 ? (['OCLOCK'] as WordId[]) : [])];
}

/** The same words as a sentence a screen reader can say. */
export function wordClockSentence(hours: number, minutes: number): string {
  return wordClockWords(hours, minutes)
    .map((w) => (w === 'OCLOCK' ? "O'CLOCK" : w.replace(/_[MH]$/, '')))
    .join(' ');
}

/** Which cells of WORD_GRID are lit, as "row:col" keys. */
export function wordClockCells(hours: number, minutes: number): Set<string> {
  const lit = new Set<string>();
  for (const w of wordClockWords(hours, minutes)) {
    const [row, col, len] = WORDS[w];
    for (let i = 0; i < len; i++) lit.add(`${row}:${col + i}`);
  }
  return lit;
}

/**
 * The binary clock: one column per digit of HH MM SS (binary-coded decimal), each a list of bits from the top (8) to the bottom (1).
 * Columns are as tall as the largest value their digit can take: tens of hours 2, tens of minutes and seconds 3, units 4.
 */
export function binaryColumns(hours: number, minutes: number, seconds: number): boolean[][] {
  const digits = [Math.floor(hours / 10), hours % 10, Math.floor(minutes / 10), minutes % 10, Math.floor(seconds / 10), seconds % 10];
  const heights = [2, 4, 3, 4, 3, 4];
  return digits.map((d, i) => Array.from({ length: heights[i]! }, (_, b) => ((d >> (heights[i]! - 1 - b)) & 1) === 1));
}
