import { Bell, Coffee, DoorOpen, Fan, House, Lightbulb, Lock, Mountain, Moon, PartyPopper, ParkingSquare, Power, Route, Star, Sun, Zap, type LucideIcon } from 'lucide-react';
import type { ActionIcon, SceneIcon } from '@headunit/shared';

export const SCENE_GLYPHS: Record<SceneIcon, LucideIcon> = { moon: Moon, sun: Sun, road: Route, coffee: Coffee, party: PartyPopper, parking: ParkingSquare, mountain: Mountain, star: Star };

/** The picture for a scene: one fixed list of icons so the server only ever stores a name. */
export function SceneGlyph({ icon, size = 20 }: { icon: SceneIcon; size?: number }) {
  const Icon = SCENE_GLYPHS[icon] ?? Star;
  return <Icon size={size} />;
}

/** The picture for a quick action (the server stores only the name). */
export const ACTION_GLYPHS: Record<ActionIcon, LucideIcon> = { zap: Zap, door: DoorOpen, home: House, lightbulb: Lightbulb, lock: Lock, bell: Bell, fan: Fan, power: Power };

export function ActionGlyph({ icon, size = 20 }: { icon: ActionIcon; size?: number }) {
  const Icon = ACTION_GLYPHS[icon] ?? Zap;
  return <Icon size={size} />;
}
