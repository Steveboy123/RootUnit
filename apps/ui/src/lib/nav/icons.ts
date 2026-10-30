import {
  Battery, Bell, Bluetooth, Calendar, Camera, Car, Circle, Cloud, Clock, Compass, Flag, Fuel, Gauge, Headphones, Heart, House, Key, LayoutGrid, Lightbulb, Lock, Map as MapIcon, Mic, Moon, Music2,
  Navigation, NotebookPen, Phone, Play, Power, Radio, Settings, Shield, SlidersHorizontal, Smartphone, Sparkles, Star, Sun, Thermometer, Timer, Video, Wifi, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@headunit/shared';

/** Named imports only (never `import { icons }`), so the bundle holds just these. A Map: an id is never used as an object key. */
export const NAV_ICON_MAP: ReadonlyMap<NavIcon, LucideIcon> = new Map<NavIcon, LucideIcon>([
  ['home', House], ['car', Car], ['music', Music2], ['radio', Radio], ['smartphone', Smartphone], ['grid', LayoutGrid], ['settings', Settings], ['gauge', Gauge],
  ['map', MapIcon], ['navigation', Navigation], ['camera', Camera], ['wrench', Wrench], ['fuel', Fuel], ['battery', Battery], ['bluetooth', Bluetooth], ['wifi', Wifi],
  ['phone', Phone], ['lightbulb', Lightbulb], ['thermometer', Thermometer], ['clock', Clock], ['timer', Timer], ['calendar', Calendar], ['cloud', Cloud], ['star', Star],
  ['heart', Heart], ['bell', Bell], ['lock', Lock], ['key', Key], ['shield', Shield], ['zap', Zap], ['play', Play], ['mic', Mic], ['headphones', Headphones],
  ['video', Video], ['notebook', NotebookPen], ['flag', Flag], ['compass', Compass], ['sun', Sun], ['moon', Moon], ['sliders', SlidersHorizontal], ['power', Power],
  ['sparkles', Sparkles],
]);

/** Shown for an icon id this build does not know (a newer build added it). */
export const FALLBACK_ICON: LucideIcon = Circle;

export const navIcon = (id: NavIcon | null | undefined): LucideIcon | null => (id ? (NAV_ICON_MAP.get(id) ?? FALLBACK_ICON) : null);
