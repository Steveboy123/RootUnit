import { GRID_COLS, GRID_ROWS, sanitizeLayout, type DashboardLayout, type WidgetInstance } from '@headunit/shared';

type Rect = Pick<WidgetInstance, 'x' | 'y' | 'w' | 'h'>;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** First free top-left-most slot for a w×h widget, or null if the page is full. */
export function findFreeSpot(widgets: Rect[], w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= GRID_ROWS; y++) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      if (!widgets.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
    }
  }
  return null;
}

/** Try the default size, then shrink toward the minimum until something fits. */
export function placeWidget(
  widgets: Rect[],
  size: { w: number; h: number },
  min: { w: number; h: number },
): Rect | null {
  for (let w = size.w; w >= min.w; w--) {
    for (let h = size.h; h >= min.h; h--) {
      const spot = findFreeSpot(widgets, w, h);
      if (spot) return { ...spot, w, h };
    }
  }
  return null;
}

/** Can the page move one place earlier (-1) or later (1)? False at either end, and for a page that is not there. */
export function canMovePage(layout: DashboardLayout, pageId: string, dir: -1 | 1): boolean {
  const from = layout.pages.findIndex((p) => p.id === pageId);
  const to = from + dir;
  return from >= 0 && to >= 0 && to < layout.pages.length;
}

/**
 * The layout with one page swapped with its neighbour: this is the order of the tabs in the top bar. A new layout and a new page list
 * (the input may be frozen), the same page objects. Pages are found by id, and the store's selected page is an id too, so the page
 * being looked at stays selected wherever it moves. The same layout comes back when the page cannot move, or if the result is not a
 * layout the server would accept (the store refuses those too: a refused move must not look as if it happened).
 */
export function movePage(layout: DashboardLayout, pageId: string, dir: -1 | 1): DashboardLayout {
  if (!canMovePage(layout, pageId, dir)) return layout;
  const from = layout.pages.findIndex((p) => p.id === pageId);
  const pages = [...layout.pages];
  [pages[from], pages[from + dir]] = [pages[from + dir]!, pages[from]!];
  const next: DashboardLayout = { ...layout, pages };
  return sanitizeLayout(next) ? next : layout;
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;
