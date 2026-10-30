import type { IncomingMessage, ServerResponse } from 'node:http';
import { type DashboardLayout, type GpsState, type ServiceMap, type ServiceName, type Settings, type VehicleState } from '@headunit/shared';
import type { Config } from '../config';
import type { DashcamCenter } from '../dashcamCenter';
import type { GpsCenter } from '../gpsCenter';
import { Observable } from '../observable';
import type { MediaProvider } from '../providers/media';
import type { VehicleProvider } from '../providers/vehicle';
import type { RadioProvider } from '../radio/radio';
import type { JsonStore } from '../store';
import type { WledCenter } from '../wledCenter';
import { FmService, type FmServiceOptions } from '../fm/service';
import { QuickActions, type ActionsOptions } from './actions';
import { settingsToRestore } from './backup';
import { Garage } from './garage';
import { createDemoHealthReader, createLinuxHealthReader, HealthMonitor } from './health';
import { DashcamService, LightingService } from './hardware';
import { DocStore } from './docs';
import { LyricsService } from './lyrics';
import { NotesService } from './notes';
import { createFeatureRoutes } from './routes';
import { ScenesService } from './scenes';
import { TimersService } from './timers';
import { TripRecorder, type TripSample } from './trips';
import { WeatherService } from './weather';

export interface FeatureDeps {
  store: JsonStore;
  config: Config;
  settings: Observable<Settings>;
  layout: Observable<DashboardLayout>;
  vehicle: VehicleProvider;
  gps: GpsCenter;
  wled: WledCenter;
  dashcam: DashcamCenter;
  media: MediaProvider;
  radio: RadioProvider;
  demo: boolean;
  /** Save and tell every screen: what the server does when it is the one changing the settings or the layout (a restored backup). */
  applySettings(next: Settings): void | Promise<void>;
  applyLayout(next: DashboardLayout): void | Promise<void>;
  /** Network access for tests. */
  fetch?: typeof fetch;
  actions?: ActionsOptions;
  /** The FM transmitter's network, processes and sockets, for tests. */
  fm?: Pick<FmServiceOptions, 'fetch' | 'spawn' | 'connect' | 'parecCommand' | 'backend'>;
  now?: () => number;
}

export interface Features {
  /** Every named state the screens follow (see ServiceMap). */
  services: { [K in ServiceName]: Observable<ServiceMap[K]> };
  /** The HTTP routes of the v2 features. Returns true when the request was answered. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean>;
  lighting: LightingService;
  dashcam: DashcamService;
  start(): Promise<void>;
  stop(): void;
}

/** The speed to trust right now: the car's own (OBD) when it is connected, otherwise the GPS's. Null when neither is live. */
export function pickSpeed(vehicle: VehicleState, gps: GpsState): { kmh: number; source: 'obd' | 'gps' } | null {
  if (vehicle.connected && !vehicle.unsupported?.includes('speedKmh') && Number.isFinite(vehicle.speedKmh)) return { kmh: vehicle.speedKmh, source: 'obd' };
  if (gps.fix && gps.speedKmh !== null) return { kmh: gps.speedKmh, source: 'gps' };
  return null;
}

export function createFeatures(deps: FeatureDeps): Features {
  const { store, config, settings, vehicle, gps, media, radio } = deps;
  const now = deps.now ?? Date.now;

  const garage = new Garage(store, now);
  const trips = new TripRecorder(store, { now, onTripEnded: (t) => garage.addDistance(t.distanceKm) });
  const health = new HealthMonitor(deps.demo ? createDemoHealthReader(now) : createLinuxHealthReader(config.dataDir));
  const weather = new WeatherService({
    store,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    now,
    position: () => {
      const g = gps.state.get();
      return g.fix && g.latitude !== null && g.longitude !== null ? { lat: g.latitude, lon: g.longitude } : null;
    },
    enabled: () => settings.get().weather,
  });
  const timers = new TimersService(store, {
    now,
    // The sleep timer quiets the car by itself: music pauses, the radio stops. Only what is actually playing is touched.
    onSleep: async () => {
      if (radio.state.get().playing) await radio.command({ cmd: 'stop' });
      if (media.state.get().playing) await media.command({ cmd: 'pause' });
    },
  });
  const scenes = new ScenesService(store);
  const actions = new QuickActions(store, { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...deps.actions });
  const notes = new NotesService(store, now);
  const lyrics = new LyricsService(deps.fetch ?? fetch, now);
  const docs = new DocStore(store);
  const lighting = new LightingService(deps.wled);
  const dashcam = new DashcamService(deps.dashcam);
  // FM transmitter: talks to a helper on a Pi that can run it (docs/fm.md). In --demo it only pretends.
  const fm = new FmService({
    store,
    config: config.fm,
    demo: deps.demo,
    now,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...deps.fm,
  });

  const handle = createFeatureRoutes({
    garage,
    trips,
    weather,
    timers,
    scenes,
    actions,
    notes,
    lyrics,
    docs,
    fm,
    settings: () => settings.get(),
    gpsTrack: () => gps.track(),
    downloadsDir: config.updater.downloadDir,
    backupSources: {
      settings: () => settings.get(),
      layout: () => deps.layout.get(),
      garage: () => garage.export(),
      trips: () => trips.export(),
      notes: () => notes.export(),
      scenes: () => scenes.export(),
      radio: () => {
        const r = radio.state.get();
        const builtIn = new Set(['somafm-groovesalad', 'somafm-defcon', 'radioparadise', 'fip']);
        return { custom: r.stations.filter((s) => !builtIn.has(s.id)).map((s) => ({ name: s.name, url: s.url, genre: s.genre, logo: s.logo })), favorites: r.favorites };
      },
    },
    backupSinks: {
      settings: (s, carried) => deps.applySettings(settingsToRestore(s, carried, settings.get())),
      layout: (l) => deps.applyLayout(l),
      garage: (raw) => garage.restore(raw),
      trips: (raw) => trips.restore(raw),
      notes: (raw) => notes.restore(raw),
      scenes: (raw) => scenes.restore(raw),
      // Stations go through the radio's own `add`, which validates every address; favourites need the ids that produces.
      radio: async (raw) => {
        const r = (raw ?? {}) as { custom?: Array<{ name?: unknown; url?: unknown; genre?: unknown; logo?: unknown }>; favorites?: unknown };
        for (const s of (Array.isArray(r.custom) ? r.custom : []).slice(0, 100)) {
          if (typeof s.name === 'string' && typeof s.url === 'string') await radio.command({ cmd: 'add', name: s.name, url: s.url, ...(typeof s.genre === 'string' ? { genre: s.genre } : {}), ...(typeof s.logo === 'string' ? { logo: s.logo } : {}) });
        }
        const known = new Set(radio.state.get().stations.map((s) => s.id));
        for (const id of (Array.isArray(r.favorites) ? r.favorites : []).slice(0, 200)) if (typeof id === 'string' && known.has(id)) await radio.command({ cmd: 'favorite', id, on: true });
      },
    },
  });

  let sampler: NodeJS.Timeout | null = null;
  let unsubscribe: Array<() => void> = [];

  return {
    services: { gps: gps.state, health: health.state, trips: trips.state, garage: garage.state, weather: weather.state, timers: timers.state, scenes: scenes.state, actions: actions.state, lighting: lighting.state, dashcam: dashcam.state, fm: fm.state },
    handle,
    lighting,
    dashcam,

    async start() {
      await Promise.all([garage.start(), trips.start(), health.start(), timers.start(), scenes.start(), actions.start(), notes.start(), weather.start(), lighting.start(), dashcam.start(), fm.start()]);
      // Once a second, hand the best speed there is to the trip recorder.
      sampler = setInterval(() => {
        const v = vehicle.state.get();
        const g = gps.state.get();
        const speed = pickSpeed(v, g);
        if (!speed) return;
        const sample: TripSample = {
          at: now(),
          speedKmh: speed.kmh,
          source: speed.source,
          fuelPct: v.connected && !v.unsupported?.includes('fuelPct') ? v.fuelPct : null,
          pos: g.fix && g.latitude !== null && g.longitude !== null ? { lat: g.latitude, lon: g.longitude } : null,
        };
        trips.ingest(sample);
      }, 1000);
      sampler.unref();
      // Switching weather on or off in Settings takes effect at once.
      unsubscribe.push(settings.subscribe(() => void weather.refresh()));
      // The GPS usually finds the sky a little after boot: get the forecast the moment it does, not at the next minute's tick.
      let hadFix = gps.state.get().fix;
      unsubscribe.push(
        gps.state.subscribe((g) => {
          if (g.fix && !hadFix) void weather.refresh();
          hadFix = g.fix;
        }),
      );
    },

    stop() {
      if (sampler) clearInterval(sampler);
      sampler = null;
      for (const u of unsubscribe) u();
      unsubscribe = [];
      garage.stop();
      trips.stop();
      health.stop();
      timers.stop();
      weather.stop();
      lighting.stop();
      dashcam.stop();
      // Sends the request that switches the carrier off at once. If it does not arrive, the helper's dead-man switch does the same within 30 s.
      void fm.stop();
    },
  };
}
