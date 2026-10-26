import { composite, minDimFor, toHex } from './contrast';
import type { Palette, PaletteSpec } from './types';

/** Finish a palette: adds minDim, computed from its own colours so it can never go stale. Every palette is built through this. */
export function definePalette(spec: PaletteSpec): Palette {
  return { ...spec, minDim: minDimFor(spec) };
}

/** What a derived palette must say about itself; every other token is optional and defaults to the base palette's. */
export type PaletteOverrides = Pick<PaletteSpec, 'id' | 'label' | 'blurb' | 'scheme'> & Partial<Omit<PaletteSpec, 'id' | 'label' | 'blurb' | 'scheme'>>;

/**
 * A new palette from a close relative: `base` with some tokens replaced, then finished with definePalette.
 * Follow-through so a palette stays coherent when only its surface colours change:
 *   scrim  follows bg  (unless given)      nav  follows bg2  (unless given)
 *   preview is rebuilt from the result     (unless given): [bg, a raised surface, accentDefault]
 * Used for placeholder palettes; a designed palette can simply call definePalette with every token written out.
 */
export function derive(base: Palette, over: PaletteOverrides): Palette {
  const { minDim: _computed, ...inherited } = base;
  const merged: PaletteSpec = {
    ...inherited,
    ...over,
    scrim: over.scrim ?? over.bg ?? inherited.scrim,
    nav: over.nav ?? over.bg2 ?? inherited.nav,
    preview: over.preview ?? ['#000000', '#000000', '#000000'],
  };
  if (!over.preview) {
    const raised = merged.scheme === 'dark' ? merged.cardHi : merged.card;
    merged.preview = [merged.bg, toHex(composite(raised, merged.bg)), merged.accentDefault];
  }
  return definePalette(merged);
}
