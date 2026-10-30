import { DEFAULT_LAYOUT, type DashboardLayout, type DashboardPage, type Settings } from '@headunit/shared';

/**
 * Ready-made Home dashboards. Applying one replaces the pages (Undo: apply Classic, or edit by hand); every widget in them can still be
 * moved, resized and removed afterwards. Each keeps the Engine page from the classic layout, so the gauges are never more than a swipe away.
 */
export interface LayoutPreset {
  id: string;
  label: string;
  blurb: string;
  layout: DashboardLayout;
  /**
   * Where the mascot goes with this layout, so it never doubles up or covers a widget: off where the hero card already holds it, behind
   * the widgets in the space left for it otherwise. Absent: the mascot is left as it is.
   */
  mascot?: Partial<Pick<Settings, 'mascotEnabled' | 'mascotPlacement' | 'mascotScope' | 'mascotX' | 'mascotY' | 'mascotSize'>>;
}

const engine = DEFAULT_LAYOUT.pages.find((p) => p.id === 'engine')!;
const withEngine = (first: DashboardPage): DashboardLayout => ({ version: 1, pages: [first, structuredClone(engine)] });

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'cockpit',
    label: 'Cockpit',
    blurb: 'A big player with your mascot, the clock and weather, and the car, FM and shortcuts underneath.',
    layout: withEngine({
      id: 'cockpit',
      name: 'Cockpit',
      widgets: [
        { id: 'c-hero', type: 'hero', x: 0, y: 0, w: 9, h: 4, config: { mascot: 'on', layout: 'card' } },
        { id: 'c-cw', type: 'clockWeather', x: 9, y: 0, w: 3, h: 4 },
        { id: 'c-car', type: 'vehicleCard', x: 0, y: 4, w: 3, h: 2 },
        { id: 'c-fm', type: 'fmTuner', x: 3, y: 4, w: 3, h: 2 },
        { id: 'c-tiles', type: 'quickTiles', x: 6, y: 4, w: 3, h: 2 },
        { id: 'c-speed', type: 'speedometer', x: 9, y: 4, w: 3, h: 2 },
      ],
    }),
    mascot: { mascotEnabled: false },
  },
  {
    id: 'player',
    label: 'Player focus',
    blurb: 'Just the music: the artwork big, the controls, nothing else.',
    layout: withEngine({ id: 'player', name: 'Player', widgets: [{ id: 'p-hero', type: 'hero', x: 0, y: 0, w: 12, h: 6, config: { mascot: 'on', layout: 'focus' } }] }),
    mascot: { mascotEnabled: false },
  },
  {
    id: 'glass-hub',
    label: 'Glass hub',
    blurb: 'Player, clock and weather, and shortcuts, with room on the right for your mascot.',
    layout: withEngine({
      id: 'hub',
      name: 'Hub',
      widgets: [
        { id: 'g-hero', type: 'hero', x: 0, y: 0, w: 8, h: 4, config: { mascot: 'off', layout: 'card' } },
        { id: 'g-cw', type: 'clockWeather', x: 8, y: 0, w: 4, h: 2 },
        { id: 'g-launch', type: 'launcher', x: 0, y: 4, w: 8, h: 2 },
      ],
    }),
    mascot: { mascotEnabled: true, mascotPlacement: 'behind', mascotScope: 'home', mascotX: 84, mascotY: 64, mascotSize: 58 },
  },
  { id: 'classic', label: 'Classic', blurb: 'Speed, music, clock and quick controls: the layout it came with.', layout: DEFAULT_LAYOUT },
];

/** A fresh copy to apply (so later edits never touch the preset). */
export const layoutOf = (preset: LayoutPreset): DashboardLayout => structuredClone(preset.layout);
