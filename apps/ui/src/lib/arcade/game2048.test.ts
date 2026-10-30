import { describe, expect, it } from 'vitest';
import { addRandom, emptyBoard, emptyCells, hasMoves, hasWon, move, newBoard, play, slideRow, start2048, type Board } from './game2048';

const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe('slideRow', () => {
  const cases: Array<[number[], number[], number]> = [
    [[2, 2, 2, 2], [4, 4, 0, 0], 8],
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    [[4, 2, 2, 0], [4, 4, 0, 0], 4],
    [[2, 0, 2, 4], [4, 4, 0, 0], 4],
    [[2, 2, 4, 4], [4, 8, 0, 0], 12],
    [[4, 4, 8, 0], [8, 8, 0, 0], 8], // a merged tile does not merge again in the same move
    [[2, 4, 8, 16], [2, 4, 8, 16], 0],
    [[0, 0, 0, 2], [2, 0, 0, 0], 0],
    [[0, 0, 0, 0], [0, 0, 0, 0], 0],
    [[2, 2, 2, 0], [4, 2, 0, 0], 4], // three in a row: the pair nearest the wall merges
  ];
  for (const [input, row, score] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(row)}`, () => expect(slideRow(input)).toEqual({ row, score }));
  }
});

describe('move', () => {
  const board: Board = [
    [2, 0, 0, 2],
    [0, 4, 4, 0],
    [8, 0, 0, 0],
    [0, 0, 0, 2],
  ];
  it('slides left', () => expect(move(board, 'left').board).toEqual([[4, 0, 0, 0], [8, 0, 0, 0], [8, 0, 0, 0], [2, 0, 0, 0]]));
  it('slides right', () => expect(move(board, 'right').board).toEqual([[0, 0, 0, 4], [0, 0, 0, 8], [0, 0, 0, 8], [0, 0, 0, 2]]));
  it('slides up', () => expect(move(board, 'up').board).toEqual([[2, 4, 4, 4], [8, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
  it('slides down', () => expect(move(board, 'down').board).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [8, 4, 4, 4]]));
  it('scores what merged', () => {
    expect(move(board, 'left').score).toBe(4 + 8);
    expect(move(board, 'up').score).toBe(4); // the two 2s in the right-hand column
  });
  it('does not change the board it was given', () => {
    const copy = JSON.parse(JSON.stringify(board));
    move(board, 'left');
    expect(board).toEqual(copy);
  });
  it('says nothing moved when nothing can', () => {
    const packed: Board = [[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    expect(move(packed, 'left').moved).toBe(false);
    expect(move(packed, 'up').moved).toBe(false);
    expect(move(packed, 'right').moved).toBe(false); // a full row has nowhere to go
    expect(move(packed, 'down').moved).toBe(true);
  });
});

describe('addRandom', () => {
  it('fills only an empty cell and leaves the rest alone', () => {
    const b: Board = [[2, 2, 2, 2], [2, 2, 2, 2], [2, 2, 0, 2], [2, 2, 2, 2]];
    const out = addRandom(b, seq(0.5, 0.5));
    expect(out[2]![2]).toBe(2);
    expect(out.flat().filter((v) => v === 2).length).toBe(16);
  });
  it('makes a 4 one time in ten, by the second random number', () => {
    expect(addRandom(emptyBoard(), seq(0, 0.95)).flat().filter((v) => v === 4)).toHaveLength(1);
    expect(addRandom(emptyBoard(), seq(0, 0.89)).flat().filter((v) => v === 4)).toHaveLength(0);
  });
  it('can pick the first and the last empty cell', () => {
    expect(addRandom(emptyBoard(), seq(0, 0))[0]![0]).not.toBe(0);
    expect(addRandom(emptyBoard(), seq(0.999999, 0))[3]![3]).not.toBe(0);
  });
  it('leaves a full board as it is', () => {
    const full: Board = Array.from({ length: 4 }, () => [2, 4, 2, 4]);
    expect(addRandom(full, seq(0))).toBe(full);
  });
});

describe('newBoard / start2048', () => {
  it('starts with two tiles', () => expect(emptyCells(newBoard(Math.random))).toHaveLength(14));
  it('starts a clean game', () => expect(start2048(Math.random)).toMatchObject({ score: 0, over: false, won: false }));
});

describe('hasMoves', () => {
  it('is false only for a full board with no equal neighbours', () => {
    const stuck: Board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
    expect(hasMoves(stuck)).toBe(false);
    const oneMerge: Board = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]];
    expect(hasMoves(oneMerge)).toBe(true);
    expect(hasMoves([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]])).toBe(true);
  });
});

describe('play', () => {
  it('adds a tile and the score after a move that changed something', () => {
    const g = { board: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as Board, score: 10, over: false, won: false };
    const next = play(g, 'left', seq(0, 0));
    expect(next.score).toBe(14);
    expect(next.board[0]![0]).toBe(4);
    expect(next.board.flat().filter((v) => v !== 0)).toHaveLength(2); // the merged 4, plus one new tile
  });
  it('does nothing for a move that changes nothing, and adds no tile', () => {
    const g = { board: [[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as Board, score: 0, over: false, won: false };
    expect(play(g, 'left', Math.random)).toBe(g);
  });
  it('ends the game when the board fills with no moves left', () => {
    const g = { board: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [0, 4, 2, 4]] as Board, score: 0, over: false, won: false };
    // sliding left leaves one gap; the new 2 lands in it and completes a board where nothing is next to an equal tile
    const next = play(g, 'left', seq(0, 0.5));
    expect(next.board).toEqual([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
    expect(next.over).toBe(true);
  });
  it('is not over while there is still room or a merge left', () => {
    const g = { board: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [0, 4, 2, 2]] as Board, score: 0, over: false, won: false };
    expect(play(g, 'left', seq(0, 0.5)).over).toBe(false);
  });
  it('ignores moves once the game is over', () => {
    const g = { board: emptyBoard(), score: 5, over: true, won: false };
    expect(play(g, 'left', Math.random)).toBe(g);
  });
  it('notices 2048, and remembers it', () => {
    const g = { board: [[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] as Board, score: 0, over: false, won: false };
    const won = play(g, 'left', seq(0.5));
    expect(hasWon(won.board)).toBe(true);
    expect(won.won).toBe(true);
    expect(play(won, 'down', seq(0.5)).won).toBe(true);
  });
});
