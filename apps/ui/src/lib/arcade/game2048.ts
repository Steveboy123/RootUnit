/** 2048: slide the tiles, equal neighbours merge. Pure functions only; the screen decides how to draw and when to ask for a move. */

export type Board = number[][];
export type Dir = 'left' | 'right' | 'up' | 'down';
export const SIZE = 4;
export const WIN_TILE = 2048;

export const emptyBoard = (): Board => Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));

/** One row slid towards index 0. A tile merges at most once per move, and the pair nearest the wall merges first: [2,2,2,2] → [4,4,0,0]. */
export function slideRow(row: readonly number[]): { row: number[]; score: number } {
  const tiles = row.filter((v) => v !== 0);
  const out: number[] = [];
  let score = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      const merged = tiles[i]! * 2;
      out.push(merged);
      score += merged;
      i++;
    } else out.push(tiles[i]!);
  }
  while (out.length < row.length) out.push(0);
  return { row: out, score };
}

const reverse = (r: readonly number[]) => [...r].reverse();
const transpose = (b: Board): Board => b[0]!.map((_, c) => b.map((r) => r[c]!));

/** The board after a move, the points it scored, and whether anything changed at all (a move that changes nothing is not a move). */
export function move(board: Board, dir: Dir): { board: Board; score: number; moved: boolean } {
  const vertical = dir === 'up' || dir === 'down';
  const flip = dir === 'right' || dir === 'down';
  const lines = vertical ? transpose(board) : board;
  let score = 0;
  const slid = lines.map((line) => {
    const r = slideRow(flip ? reverse(line) : line);
    score += r.score;
    return flip ? reverse(r.row) : r.row;
  });
  const next = vertical ? transpose(slid) : slid;
  const moved = next.some((r, y) => r.some((v, x) => v !== board[y]![x]));
  return { board: next, score, moved };
}

export function emptyCells(board: Board): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  board.forEach((r, y) => r.forEach((v, x) => v === 0 && out.push([y, x])));
  return out;
}

/** A new tile in a random empty cell: a 2, or one time in ten a 4. A full board is returned unchanged. */
export function addRandom(board: Board, rng: () => number): Board {
  const cells = emptyCells(board);
  if (cells.length === 0) return board;
  const [y, x] = cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))]!;
  return board.map((r, yy) => (yy === y ? r.map((v, xx) => (xx === x ? (rng() < 0.9 ? 2 : 4) : v)) : r));
}

export const newBoard = (rng: () => number): Board => addRandom(addRandom(emptyBoard(), rng), rng);

export const hasMoves = (board: Board): boolean => (['left', 'right', 'up', 'down'] as const).some((d) => move(board, d).moved);

export const highestTile = (board: Board): number => Math.max(0, ...board.flat());
export const hasWon = (board: Board): boolean => highestTile(board) >= WIN_TILE;

export interface Game2048 {
  board: Board;
  score: number;
  over: boolean;
  /** The 2048 tile has been made at least once (the player may carry on). */
  won: boolean;
}

export const start2048 = (rng: () => number): Game2048 => ({ board: newBoard(rng), score: 0, over: false, won: false });

/** Apply a move and, if it changed the board, the new tile that follows it. Ignored once the game is over. */
export function play(game: Game2048, dir: Dir, rng: () => number): Game2048 {
  if (game.over) return game;
  const m = move(game.board, dir);
  if (!m.moved) return game;
  const board = addRandom(m.board, rng);
  return { board, score: game.score + m.score, over: !hasMoves(board), won: game.won || hasWon(board) };
}
