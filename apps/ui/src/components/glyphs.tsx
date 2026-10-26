import { Car, Coffee, Eye, Lightbulb, Mountain, Moon, PartyPopper, ParkingSquare, Route, Star, Sun, Sunrise, Users, Zap, type LucideIcon } from 'lucide-react';
import type { ActionIcon, SceneIcon } from '@headunit/shared';

export const SCENE_GLYPHS: Record<SceneIcon, LucideIcon> = { moon: Moon, sun: Sun, road: Route, coffee: Coffee, party: PartyPopper, parking: ParkingSquare, mountain: Mountain, star: Star };

/** The picture for a scene: one fixed list of icons so the server only ever stores a name. */
export function SceneGlyph({ icon, size = 20 }: { icon: SceneIcon; size?: number }) {
  const Icon = SCENE_GLYPHS[icon] ?? Star;
  return <Icon size={size} />;
}

/** The picture for a quick action (the server stores only the name). */
export const ACTION_GLYPHS: Record<ActionIcon, LucideIcon> = { zap: Zap, door: Car, home: Sunrise, lightbulb: Lightbulb, lock: Eye, bell: Users, fan: Sun, power: Zap };
