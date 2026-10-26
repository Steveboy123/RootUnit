import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Calculator,
  CloudSun,
  Cpu,
  Flag,
  Fuel,
  Gamepad2,
  Gauge,
  Lightbulb,
  MapPinned,
  NotebookPen,
  RadioTower,
  Route as RouteIcon,
  Satellite,
  Smartphone,
  Timer,
  Video,
  Waves,
  WandSparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Tone } from '../components/ui';
import type { Route } from '../store';

export type AppGroup = 'Car' | 'Car Lab' | 'Everyday' | 'Play';
export const APP_GROUPS: AppGroup[] = ['Car', 'Car Lab', 'Everyday', 'Play'];

/** A small badge on the launcher tile ("2 due", "REC"): what needs a glance without opening the app. */
export type AppBadge = { text: string; tone: Tone } | null;

export interface AppDef {
  id: string;
  name: string;
  /** One line under the name on the launcher. */
  description: string;
  /** A shorter name (10 characters at most) for the navigation dock, where the full name would not fit. */
  short?: string;
  icon: LucideIcon;
  group: AppGroup;
  /** Two colours for the launcher tile's icon (the theme's accent pair when absent). */
  hue?: number;
  /** An existing page the tile opens (Phones, Vehicle). Otherwise `Component` is shown inside the app host. */
  route?: Route;
  Component?: LazyExoticComponent<ComponentType> | ComponentType;
  /** Needs the keyboard or full attention: locked while the car is moving (a passenger can lift it). */
  parkedOnly?: boolean;
}

const page = <T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await loader())[name] as ComponentType }));

/** Every app, in launcher order. Apps are loaded on first open, which keeps the Pi's start-up light. */
export const APPS: AppDef[] = [
  { id: 'trips', name: 'Trips', description: 'Every journey, by itself', icon: RouteIcon, group: 'Car', hue: 200, Component: page(() => import('./Trips'), 'TripsApp') },
  { id: 'garage', name: 'Garage', description: 'Fuel, service and documents', icon: Fuel, group: 'Car', hue: 28, Component: page(() => import('./Garage'), 'GarageApp') },
  { id: 'system', name: 'System', description: 'Power, heat and storage', icon: Cpu, group: 'Car', hue: 160, Component: page(() => import('./System'), 'SystemApp') },
  { id: 'findcar', name: 'Find my car', short: 'Find car', description: 'Parking spot and meter', icon: MapPinned, group: 'Car', hue: 350, Component: page(() => import('./FindCar'), 'FindCarApp') },
  { id: 'perf', name: 'Performance', short: 'Perf', description: '0–100 and quarter mile', icon: Flag, group: 'Car', hue: 5, Component: page(() => import('./Perf'), 'PerfApp') },
  { id: 'gps', name: 'GPS', description: 'Position and trip track', icon: Satellite, group: 'Car Lab', hue: 190, Component: page(() => import('./GPS'), 'GpsApp') },
  { id: 'lights', name: 'Lights', description: 'Ambient colour and effects', icon: Lightbulb, group: 'Car Lab', hue: 50, Component: page(() => import('./Lights'), 'LightsApp') },
  { id: 'dashcam', name: 'Dashcam', description: 'Loop recording', icon: Video, group: 'Car Lab', hue: 0, Component: page(() => import('./Dashcam'), 'DashcamApp') },
  { id: 'fm', name: 'FM transmitter', short: 'FM', description: 'Play the head unit’s sound on a car radio', icon: RadioTower, group: 'Car Lab', hue: 280, Component: page(() => import('./Fm'), 'FmApp') },
  { id: 'scenes', name: 'Scenes', description: 'Look, light and sound in one tap', icon: WandSparkles, group: 'Everyday', hue: 265, Component: page(() => import('./Scenes'), 'ScenesApp') },
  { id: 'actions', name: 'Quick actions', short: 'Actions', description: 'Garage door, lights, webhooks', icon: Zap, group: 'Everyday', hue: 45, Component: page(() => import('./QuickActions'), 'QuickActionsApp') },
  { id: 'notes', name: 'Notes', description: 'Lists and reminders', icon: NotebookPen, group: 'Everyday', hue: 40, Component: page(() => import('./Notes'), 'NotesApp') },
  { id: 'weather', name: 'Weather', description: 'Where you are, and ahead', icon: CloudSun, group: 'Everyday', hue: 205, Component: page(() => import('./Weather'), 'WeatherApp') },
  { id: 'timers', name: 'Timers', description: 'Countdowns and stopwatch', icon: Timer, group: 'Everyday', hue: 140, Component: page(() => import('./Timers'), 'TimersApp') },
  { id: 'sounds', name: 'Sleep sounds', short: 'Sounds', description: 'Rain, waves and noise to rest by', icon: Waves, group: 'Everyday', hue: 225, Component: page(() => import('./Sounds'), 'SoundsApp') },
  { id: 'tools', name: 'Tools', description: 'Converter, tip split, world clocks', icon: Calculator, group: 'Everyday', hue: 175, parkedOnly: true, Component: page(() => import('./Tools'), 'ToolsApp') },
  { id: 'arcade', name: 'Arcade', description: '2048 and Snake, parked only', icon: Gamepad2, group: 'Play', hue: 300, parkedOnly: true, Component: page(() => import('./Arcade'), 'ArcadeApp') },
  { id: 'devices', name: 'Phones', description: 'Bluetooth phones and audio', icon: Smartphone, group: 'Car', hue: 215, route: 'devices' },
  { id: 'vehicle', name: 'Vehicle', description: 'Live data and fault codes', icon: Gauge, group: 'Car', hue: 15, route: 'vehicle' },
];

export const appById = (id: string | null): AppDef | undefined => APPS.find((a) => a.id === id);
export { page as lazyPage };
