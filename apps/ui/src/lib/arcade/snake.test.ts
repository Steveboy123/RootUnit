import { describe, expect, it } from 'vitest';
import { newSnake, placeFood, step, tickMs, turn, type Snake } from './snake';

const rng = () => 0;
const base = (over: Partial<Snake> = {}): Snake => ({
  w: 6,
  h: 4,
  body: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  heading: 'right',
  queue: [],
  food: { x: 5, y: 3 },
  score: 0,
  alive: true,
  won: false,
  ...over,
});

describe('step', () => {
  it('moves one cell, keeping its length', () => {
    const s = step(base(), rng);
    expect(s.body).toEqual([{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }]);
    expect(s.alive).toBe(true);
  });
  it('grows and scores on food, and puts the next food somewhere free', () => {
    const s = step(base({ food: { x: 3, y: 1 } }), rng);
    expect(s.body).toHaveLength(4);
    expect(s.score).toBe(1);
    expect(s.food).not.toBeNull();
    expect(s.body.some((p) => p.x === s.food!.x && p.y === s.food!.y)).toBe(false);
  });
  it('dies on every wall', () => {
    expect(step(base({ body: [{ x: 5, y: 1 }, { x: 4, y: 1 }], heading: 'right' }), rng).alive).toBe(false);
    expect(step(base({ body: [{ x: 0, y: 1 }, { x: 1, y: 1 }], heading: 'left' }), rng).alive).toBe(false);
    expect(step(base({ body: [{ x: 2, y: 0 }, { x: 2, y: 1 }], heading: 'up' }), rng).alive).toBe(false);
    expect(step(base({ body: [{ x: 2, y: 3 }, { x: 2, y: 2 }], heading: 'down' }), rng).alive).toBe(false);
  });
  it('dies running into its own body', () => {
    // a long snake curling round so that turning up hits itself
    const s = base({
      w: 8,
      h: 8,
      body: [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
      heading: 'right',
      queue: ['up'],
    });
    expect(step(s, rng).alive).toBe(false);
  });
  it('may follow its own tail, which moves away on the same tick', () => {
    // the head turns into the very cell the tail is leaving on this tick
    const s = base({
      w: 4,
      h: 4,
      body: [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      heading: 'left',
      food: { x: 3, y: 3 },
    });
    const next = step(s, rng); // head goes to (0,1), where the tail was
    expect(next.alive).toBe(true);
    expect(next.body[0]).toEqual({ x: 0, y: 1 });
  });
  it('does not let it follow the tail on the tick it eats, because then the tail stays', () => {
    const s = base({
      w: 4,
      h: 4,
      body: [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      heading: 'left',
      food: { x: 0, y: 1 },
    });
    expect(step(s, rng).alive).toBe(false);
  });
  it('does nothing once dead', () => {
    const dead = base({ alive: false });
    expect(step(dead, rng)).toBe(dead);
  });
  it('wins when the last free cell is eaten', () => {
    const s: Snake = { w: 2, h: 2, body: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], heading: 'right', queue: [], food: { x: 1, y: 0 }, score: 0, alive: true, won: false };
    const next = step(s, rng);
    expect(next.won).toBe(true);
    expect(next.food).toBeNull();
    expect(next.alive).toBe(true);
  });
});

describe('turn', () => {
  it('queues a sideways turn and applies it on the next tick', () => {
    const s = step(turn(base(), 'down'), rng);
    expect(s.body[0]).toEqual({ x: 2, y: 2 });
    expect(s.heading).toBe('down');
    expect(s.queue).toEqual([]);
  });
  it('ignores a reversal into the neck', () => {
    const s = base();
    expect(turn(s, 'left')).toBe(s);
  });
  it('two quick turns are both kept, and the second cannot reverse the first', () => {
    const s = turn(turn(base(), 'down'), 'left');
    expect(s.queue).toEqual(['down', 'left']);
    expect(turn(s, 'right')).toBe(s); // right would reverse the queued left
  });
  it('ignores asking for the direction it is already going, and does not queue without limit', () => {
    const s = base();
    expect(turn(s, 'right')).toBe(s);
    let q = s;
    for (const d of ['down', 'left', 'up', 'right', 'down'] as const) q = turn(q, d);
    expect(q.queue.length).toBeLessThanOrEqual(3);
  });
  it('ignores a dead snake', () => {
    const dead = base({ alive: false });
    expect(turn(dead, 'down')).toBe(dead);
  });
});

describe('placeFood', () => {
  it('never lands on the snake, for any random number', () => {
    const body = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    for (let r = 0; r < 1; r += 0.05) {
      const f = placeFood(3, 2, body, () => r)!;
      expect(f.y).toBe(1);
    }
  });
  it('is null when there is nowhere left', () => {
    expect(placeFood(2, 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }], rng)).toBeNull();
  });
});

describe('newSnake', () => {
  it('starts inside the board, heading right, with food off the snake', () => {
    const s = newSnake(20, 12, Math.random);
    expect(s.body.every((p) => p.x >= 0 && p.x < 20 && p.y >= 0 && p.y < 12)).toBe(true);
    expect(s.heading).toBe('right');
    expect(s.body.some((p) => p.x === s.food!.x && p.y === s.food!.y)).toBe(false);
  });
});

describe('tickMs', () => {
  it('speeds up with the score but never beyond the floor', () => {
    expect(tickMs(0)).toBeGreaterThan(tickMs(10));
    expect(tickMs(10_000)).toBe(70);
  });
});
