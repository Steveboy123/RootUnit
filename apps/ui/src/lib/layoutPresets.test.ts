import { describe, expect, it } from 'vitest';
import { sanitizeLayout } from '@headunit/shared';
import { WIDGETS } from '../widgets/registry';
import { fits } from './grid';
import { LAYOUT_PRESETS, layoutOf } from './layoutPresets';

describe('layout presets', () => {
  it.each(LAYOUT_PRESETS.map((p) => [p.id, p] as const))('%s passes the layout validator unchanged', (_id, p) => {
    expect(sanitizeLayout(layoutOf(p))).toEqual(p.layout);
  });

  it.each(LAYOUT_PRESETS.map((p) => [p.id, p] as const))('%s only uses known widgets, at least their minimum size, with no overlaps', (_id, p) => {
    for (const page of p.layout.pages) {
      page.widgets.forEach((w, i) => {
        const def = WIDGETS.find((d) => d.type === w.type);
        expect(def, w.type).toBeDefined();
        expect(w.w).toBeGreaterThanOrEqual(def!.min.w);
        expect(w.h).toBeGreaterThanOrEqual(def!.min.h);
        expect(fits(w, page.widgets.filter((_, j) => j !== i)), `${page.id}/${w.id}`).toBe(true);
      });
    }
  });

  it('a layout that puts the mascot in its hero card turns the separate mascot off, so it never shows twice', () => {
    for (const p of LAYOUT_PRESETS) {
      const inCard = p.layout.pages.some((pg) => pg.widgets.some((w) => w.type === 'hero' && w.config?.mascot !== 'off'));
      if (inCard) expect(p.mascot?.mascotEnabled, p.id).toBe(false);
    }
  });

  it('has unique ids and labels, and a copy never shares objects with the preset', () => {
    expect(new Set(LAYOUT_PRESETS.map((p) => p.id)).size).toBe(LAYOUT_PRESETS.length);
    const copy = layoutOf(LAYOUT_PRESETS[0]!);
    copy.pages[0]!.widgets[0]!.x = 5;
    expect(LAYOUT_PRESETS[0]!.layout.pages[0]!.widgets[0]!.x).toBe(0);
  });
});
