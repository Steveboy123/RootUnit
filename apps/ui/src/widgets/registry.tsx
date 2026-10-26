import { Activity, Clock, CloudSun, Compass, Cpu, Gauge, History, Hourglass, LayoutGrid, MapPinned, Music, Navigation, Radio, Route, SlidersHorizontal, Smartphone, Timer, WandSparkles, Wrench, Zap } from 'lucide-react';
import { METRICS } from '../lib/metrics';
import { GaugeWidget, Speedometer, Tachometer } from './gauges';
import { ActionsWidget, FindCarWidget, GarageWidget, HealthWidget, ScenesWidget, TimersWidget, TripsTodayWidget, WeatherWidget } from './glance';
import { NowPlayingWidget, RadioPresets, RecentTiles } from './media';
import { ClockWidget, CompassWidget, DevicesWidget, GpsMini, LauncherWidget, QuickControls, TripWidget } from './simple';
import type { WidgetDef } from './types';

/** Every widget the dashboard offers (the grid is 12 × 6). Types are stored in layouts, so they never change; new ones are added. */
export const WIDGETS: WidgetDef[] = [
  { type: 'speedometer', name: 'Speedometer', description: 'Speed in your gauge style, with peak hold', icon: Gauge, group: 'Driving', size: { w: 4, h: 4 }, min: { w: 2, h: 2 }, Component: Speedometer },
  { type: 'tachometer', name: 'Tachometer', description: 'RPM with redline and shift light', icon: Timer, group: 'Driving', size: { w: 4, h: 4 }, min: { w: 2, h: 2 }, Component: Tachometer },
  {
    type: 'gauge',
    name: 'Gauge',
    description: 'Any engine metric: coolant, fuel, battery…',
    icon: Activity,
    group: 'Car',
    size: { w: 3, h: 2 },
    min: { w: 2, h: 1 },
    config: [{ key: 'metric', label: 'Metric', default: 'coolant', options: METRICS.filter((m) => m.id !== 'speed' && m.id !== 'rpm').map((m) => ({ value: m.id, label: m.label })) }],
    Component: GaugeWidget,
  },
  { type: 'gps', name: 'Satellite GPS', description: 'USB GPS speed, heading and trip distance', icon: Compass, group: 'Driving', size: { w: 4, h: 2 }, min: { w: 3, h: 2 }, Component: GpsMini },
  { type: 'compass', name: 'Compass', description: 'A compass rose that turns with the car', icon: Navigation, group: 'Driving', size: { w: 3, h: 3 }, min: { w: 2, h: 2 }, Component: CompassWidget },
  { type: 'nowPlaying', name: 'Now Playing', description: 'Music controls and animated artwork', icon: Music, group: 'Music', size: { w: 5, h: 4 }, min: { w: 3, h: 1 }, Component: NowPlayingWidget },
  { type: 'recent', name: 'Jump back in', description: 'Recently played — tap to resume', icon: History, group: 'Music', size: { w: 5, h: 2 }, min: { w: 3, h: 1 }, Component: RecentTiles },
  { type: 'radioPresets', name: 'Radio presets', description: 'One-tap favourite stations', icon: Radio, group: 'Music', size: { w: 5, h: 2 }, min: { w: 3, h: 1 }, Component: RadioPresets },
  { type: 'clock', name: 'Clock', description: 'Time and date', icon: Clock, group: 'Everyday', size: { w: 3, h: 2 }, min: { w: 2, h: 1 }, Component: ClockWidget },
  { type: 'trip', name: 'Trip', description: 'Distance, time, average and top speed', icon: Route, group: 'Driving', size: { w: 4, h: 2 }, min: { w: 3, h: 1 }, Component: TripWidget },
  { type: 'quickControls', name: 'Volume & brightness', description: 'Quick sliders', icon: SlidersHorizontal, group: 'Everyday', size: { w: 3, h: 2 }, min: { w: 3, h: 1 }, Component: QuickControls },
  { type: 'devices', name: 'Phones', description: 'Connected phones with battery and signal', icon: Smartphone, group: 'Everyday', size: { w: 4, h: 2 }, min: { w: 3, h: 1 }, Component: DevicesWidget },
  { type: 'launcher', name: 'Launcher', description: 'Android Auto, Music, YouTube Music, Settings', icon: LayoutGrid, group: 'Everyday', size: { w: 5, h: 2 }, min: { w: 3, h: 1 }, Component: LauncherWidget },
  { type: 'weather', name: 'Weather', description: 'Now, today’s high and low, road warnings', icon: CloudSun, group: 'Everyday', size: { w: 3, h: 2 }, min: { w: 2, h: 2 }, Component: WeatherWidget },
  { type: 'tripsToday', name: 'Today’s driving', description: 'Distance and trips so far today', icon: Route, group: 'Car', size: { w: 3, h: 2 }, min: { w: 2, h: 2 }, Component: TripsTodayWidget },
  { type: 'garage', name: 'Garage reminders', description: 'Service and documents that are due', icon: Wrench, group: 'Car', size: { w: 4, h: 2 }, min: { w: 3, h: 2 }, Component: GarageWidget },
  { type: 'findCar', name: 'Find my car', description: 'Distance and direction to where you parked', icon: MapPinned, group: 'Car', size: { w: 3, h: 2 }, min: { w: 2, h: 2 }, Component: FindCarWidget },
  { type: 'timers', name: 'Timers', description: 'Running countdowns and parking meter', icon: Hourglass, group: 'Everyday', size: { w: 3, h: 2 }, min: { w: 2, h: 2 }, Component: TimersWidget },
  { type: 'system', name: 'System health', description: 'Pi temperature, power and storage', icon: Cpu, group: 'Car', size: { w: 3, h: 2 }, min: { w: 2, h: 2 }, Component: HealthWidget },
  { type: 'scenes', name: 'Scenes', description: 'Look, light and sound in one tap', icon: WandSparkles, group: 'Everyday', size: { w: 5, h: 2 }, min: { w: 3, h: 1 }, Component: ScenesWidget },
  { type: 'quickActions', name: 'Quick actions', description: 'Garage door, lights, web-hooks', icon: Zap, group: 'Everyday', size: { w: 5, h: 2 }, min: { w: 3, h: 1 }, Component: ActionsWidget },
];

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type);
