/** Snake on a small grid. Pure: `step` gives the next state and the screen owns the clock. */

export interface Pt {
  x: number;
  y: number;
}
export type Heading = 'up' | 'down' | 'left' | 'right';

export interface Snake {
  w: number;
  h: number;
  /** Head first. */
  body: Pt[];
  heading: Heading;
  /** Turns waiting to be applied, one per tick, so two quick taps make two turns instead of one reversing into the neck. */
  queue: Heading[];
  food: Pt | null;
  score: number;
  alive: boolean;
  /** The board is full: nothing more to eat. */
  won: boolean;
}

const DELTA: Record<Heading, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Heading, Heading> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const MAX_QUEUE = 3;

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

/** A random free cell, or null when the snake fills the board. */
export function placeFood(w: number, h: number, body: readonly Pt[], rng: () => number): Pt | null {
  const taken = new Set(body.map((p) => p.y * w + p.x));
  const free: Pt[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!taken.has(y * w + x)) free.push({ x, y });
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rng() * free.length))]!;
}

export function newSnake(w: number, h: number, rng: () => number): Snake {
  const y = Math.floor(h / 2);
  const body = [{ x: 2, y }, { x: 1, y }, { x: 0, y }];
  return { w, h, body, heading: 'right', queue: [], food: placeFood(w, h, body, rng), score: 0, alive: true, won: false };
}

/** Ask for a turn. A reversal into the neck is ignored, and so is repeating the direction already queued last. */
export function turn(s: Snake, to: Heading): Snake {
  if (!s.alive) return s;
  const last = s.queue.at(-1) ?? s.heading;
  if (to === last || to === OPPOSITE[last] || s.queue.length >= MAX_QUEUE) return s;
  return { ...s, queue: [...s.queue, to] };
}

/** One tick: apply a waiting turn, move, eat or not, die on a wall or on yourself. */
export function step(s: Snake, rng: () => number): Snake {
  if (!s.alive) return s;
  const [next, ...rest] = s.queue;
  const heading = next ?? s.heading;
  const d = DELTA[heading];
  const head = { x: s.body[0]!.x + d.x, y: s.body[0]!.y + d.y };
  if (head.x < 0 || head.y < 0 || head.x >= s.w || head.y >= s.h) return { ...s, heading, queue: rest, alive: false };

  const eats = s.food !== null && same(head, s.food);
  // The tail moves out of the way on the same tick, so chasing your own tail is legal unless you have just eaten.
  const grown = [head, ...s.body];
  const body = eats ? grown : grown.slice(0, -1);
  if (body.slice(1).some((p) => same(p, head))) return { ...s, heading, queue: rest, alive: false };

  if (!eats) return { ...s, body, heading, queue: rest };
  const food = placeFood(s.w, s.h, body, rng);
  return { ...s, body, heading, queue: rest, food, score: s.score + 1, won: food === null };
}

/** Milliseconds between ticks: gentle at first, quicker as the snake grows, never faster than 70. */
export const tickMs = (score: number): number => Math.max(70, 190 - score * 6);
