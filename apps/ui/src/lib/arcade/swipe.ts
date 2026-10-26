import type { Dir } from './game2048';

/** Which way a finger moved: the longer axis wins (a tie goes sideways), and a tap or a tiny wobble is no swipe at all. */
export function swipeDir(dx: number, dy: number, min = 28): Dir | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Arrow keys and WASD. Anything else, or a key with a modifier held (browser shortcuts), is not ours. */
export function keyDir(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): Dir | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down';
    default:
      return null;
  }
}
