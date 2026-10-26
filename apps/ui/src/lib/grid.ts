import { GRID_COLS, GRID_ROWS } from '@headunit/shared';

/** A widget's cell rectangle on the 12 × 6 dashboard grid. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Inside the grid and clear of every other widget. */
export function fits(rect: Rect, others: readonly Rect[], cols = GRID_COLS, rows = GRID_ROWS): boolean {
  if (rect.x < 0 || rect.y < 0 || rect.w < 1 || rect.h < 1 || rect.x + rect.w > cols || rect.y + rect.h > rows) return false;
  return others.every((o) => !overlaps(rect, o));
}

/** Pixel geometry of the grid: the size of one cell and the gap between cells. */
export interface GridMetrics {
  cellW: number;
  cellH: number;
  gap: number;
}

export function gridMetrics(width: number, height: number, gap: number, cols = GRID_COLS, rows = GRID_ROWS): GridMetrics {
  return { cellW: Math.max(1, (width - gap * (cols - 1)) / cols), cellH: Math.max(1, (height - gap * (rows - 1)) / rows), gap };
}

/** Where a rect sits on screen, in px. */
export function rectToPx(r: Rect, m: GridMetrics): { left: number; top: number; width: number; height: number } {
  return { left: r.x * (m.cellW + m.gap), top: r.y * (m.cellH + m.gap), width: r.w * m.cellW + (r.w - 1) * m.gap, height: r.h * m.cellH + (r.h - 1) * m.gap };
}

/** A rect moved by a pixel distance, snapped to whole cells and kept inside the grid. */
export function movedBy(r: Rect, dxPx: number, dyPx: number, m: GridMetrics, cols = GRID_COLS, rows = GRID_ROWS): Rect {
  const x = Math.round(r.x + dxPx / (m.cellW + m.gap));
  const y = Math.round(r.y + dyPx / (m.cellH + m.gap));
  return { ...r, x: Math.min(cols - r.w, Math.max(0, x)), y: Math.min(rows - r.h, Math.max(0, y)) };
}

/** A rect resized by a pixel distance from its bottom-right corner, snapped, at least `min` and inside the grid. */
export function resizedBy(r: Rect, dxPx: number, dyPx: number, m: GridMetrics, min: { w: number; h: number }, cols = GRID_COLS, rows = GRID_ROWS): Rect {
  const w = Math.round(r.w + dxPx / (m.cellW + m.gap));
  const h = Math.round(r.h + dyPx / (m.cellH + m.gap));
  return { ...r, w: Math.min(cols - r.x, Math.max(min.w, w)), h: Math.min(rows - r.y, Math.max(min.h, h)) };
}

/** Which way a horizontal swipe changes the dashboard page: 1 = next, -1 = previous, 0 = not a page swipe. */
export function swipePage(dx: number, dy: number, threshold = 80): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
