import { create } from 'zustand';
import {
  DEFAULT_LAYOUT,
  mergeSettings,
  sanitizeLayout,
  sanitizeSettings,
  type AndroidAutoDevCommand,
  type AndroidAutoDevState,
  type CameraState,
  type DashboardLayout,
  type DeviceCommand,
  type DiagnosticsCommand,
  type DiagnosticsState,
  type DevicesState,
  type MediaCommand,
  type MediaState,
  type NavConfig,
  type ProjectionState,
  type RadioCommand,
  type RadioState,
  type ServerMessage,
  type ServiceMap,
  type ServiceName,
  type Settings,
  type SettingsPatch,
  type SystemPatch,
  type SystemState,
  type VehicleState,
} from '@headunit/shared';
import { connectSocket } from './lib/socket';

/**
 * Where the UI is. `apps` is the launcher; `app` hosts one of the small apps (Garage, Trips, Weather...) named by `appId`;
 * `nowplaying` is the full-screen player. `devices` and `vehicle` are pages reached from the launcher and the status bar.
 */
export type Route = 'home' | 'drive' | 'media' | 'aa' | 'apps' | 'app' | 'nowplaying' | 'devices' | 'vehicle' | 'settings';
export type AppId = string;
export type MusicTab = 'spotify' | 'tidal' | 'youtube-music' | 'radio';

/**
 * The Music tab to open first, from the first snapshot: whatever is audible (radio), otherwise the tab of the saved music source
 * ('tidal', or 'auto' while TIDAL is the service the hub resolved to), otherwise the tab already selected (Spotify on a fresh boot).
 * Opening the right tab matters because the Spotify pane saves
 * musicSource = 'spotify' when it opens, which would take the hub away from TIDAL.
 */
export function initialMusicTab(opts: { radioPlaying: boolean; musicSource: Settings['musicSource']; provider: MediaState['provider'] | undefined; current: MusicTab }): MusicTab {
  if (opts.radioPlaying) return 'radio';
  if (opts.musicSource === 'tidal' || (opts.musicSource === 'auto' && opts.provider === 'tidal')) return 'tidal';
  return opts.current;
}

/** What a page with its own browser player (YouTube Music, native TIDAL) reports about what it is playing: the server knows nothing of it. */
export interface LocalNowPlaying {
  source: 'tidal' | 'youtube-music';
  id: string;
  title: string;
  artist: string;
  album?: string;
  artUrl?: string;
  durationMs: number;
  progressMs: number;
  playing: boolean;
  volume?: number;
}

export type LocalMediaAction = 'toggle' | 'next' | 'prev';

interface HeadUnit {
  conn: 'connecting' | 'open' | 'closed';
  /** True once the first snapshot has arrived. */
  ready: boolean;
  settings: Settings | null;
  layout: DashboardLayout;
  vehicle: VehicleState | null;
  media: MediaState | null;
  system: SystemState | null;
  projection: ProjectionState | null;
  androidAutoDev: AndroidAutoDevState | null;
  devices: DevicesState | null;
  radio: RadioState | null;
  camera: CameraState | null;
  diagnostics: DiagnosticsState | null;
  /** The named services pushed by the server (GPS, trips, garage, weather, ...). Each is undefined until the first snapshot. */
  svc: Partial<ServiceMap>;
  /** The server runs with simulated hardware (--demo): everything shown is made up and is labelled as such. */
  demo: boolean;
  /** How many full snapshots have arrived (one per connection): lets a screen wait for the first one after a reconnect. */
  snapshots: number;
  /** Set by the pages with a local player while a track is selected there, null otherwise. */
  localNowPlaying: LocalNowPlaying | null;

  route: Route;
  /** Which way the last navigation went (1 deeper/forward, -1 back): page transitions slide with it. */
  navDir: 1 | -1;
  /** Which small app is open while `route` is 'app'. */
  appId: AppId | null;
  /** The pull-down panel with the quick controls. */
  quickPanel: boolean;
  /** The dimmed standby clock covers the screen. */
  standby: boolean;
  musicTab: MusicTab;
  /** "I'm a passenger": lifts the typing lockout until the page is reloaded. */
  passenger: boolean;
  toast: string | null;
  pageId: string;
  editing: boolean;
  /** The navigation editor is open (and on which tab). Mounted once at the top of the app; see lib/nav openNavEditor. */
  navEditor: { tab: 'items' | 'look' } | null;
  /** The rail being edited. While set, the rail shows it instead of the saved one, so changes are visible at once. */
  navDraft: NavConfig | null;

  go(route: Route): void;
  /** Open one of the small apps from the launcher. */
  openApp(id: AppId): void;
  back(): void;
  setQuickPanel(on: boolean): void;
  setStandby(on: boolean): void;
  setMusicTab(t: MusicTab): void;
  setPassenger(on: boolean): void;
  showToast(message: string): void;
  setPage(id: string): void;
  setEditing(on: boolean): void;
  setNavEditor(editor: { tab: 'items' | 'look' } | null): void;
  setNavDraft(draft: NavConfig | null): void;
  setLocalNowPlaying(now: LocalNowPlaying | null): void;
  localMedia_cmd(action: LocalMediaAction): void;

  media_cmd(c: MediaCommand): void;
  patchSystem(p: SystemPatch): void;
  patchSettings(p: SettingsPatch): void;
  setLayout(l: DashboardLayout): void;
  projection_cmd(c: 'launch' | 'stop'): void;
  androidAutoDev_cmd(c: AndroidAutoDevCommand): void;
  device_cmd(c: DeviceCommand): void;
  radio_cmd(c: RadioCommand): void;
  camera_cmd(c: 'show' | 'hide' | 'toggle'): void;
  diagnostics_cmd(c: DiagnosticsCommand): void;
}

/** Where each page sits, left to right, so a page transition knows which way to move. */
const ROUTE_ORDER: Record<Route, number> = { home: 0, drive: 1, media: 2, nowplaying: 2.5, aa: 3, apps: 4, app: 4.5, devices: 4.6, vehicle: 4.7, settings: 9 };
const dirOf = (from: Route, to: Route): 1 | -1 => (ROUTE_ORDER[to] >= ROUTE_ORDER[from] ? 1 : -1);

let socket: ReturnType<typeof connectSocket> | null = null;
let layoutTimer: number | undefined;
let toastTimer: number | undefined;
interface Place {
  route: Route;
  appId: AppId | null;
}
const routeHistory: Place[] = [{ route: 'home', appId: null }];

export const useHeadUnit = create<HeadUnit>((set, get) => ({
  conn: 'connecting',
  ready: false,
  settings: null,
  layout: structuredClone(DEFAULT_LAYOUT),
  vehicle: null,
  media: null,
  system: null,
  projection: null,
  androidAutoDev: null,
  devices: null,
  radio: null,
  camera: null,
  diagnostics: null,
  svc: {},
  demo: false,
  snapshots: 0,
  localNowPlaying: null,

  route: 'home',
  navDir: 1,
  appId: null,
  quickPanel: false,
  standby: false,
  musicTab: 'spotify',
  passenger: false,
  toast: null,
  pageId: DEFAULT_LAYOUT.pages[0]!.id,
  editing: false,
  navEditor: null,
  navDraft: null,

  go: (route) => {
    const cur = get();
    // The app host needs an app: going to it without one means the launcher.
    const target: Route = route === 'app' ? 'apps' : route;
    if (target === cur.route) return set({ quickPanel: false });
    routeHistory.push({ route: target, appId: null });
    if (routeHistory.length > 12) routeHistory.splice(0, routeHistory.length - 12);
    set({ route: target, navDir: dirOf(cur.route, target), appId: null, quickPanel: false, editing: target === 'home' ? cur.editing : false });
  },
  openApp: (id) => {
    routeHistory.push({ route: 'app', appId: id });
    if (routeHistory.length > 12) routeHistory.splice(0, routeHistory.length - 12);
    set({ route: 'app', navDir: 1, appId: id, quickPanel: false, editing: false });
  },
  back: () => {
    const cur = get();
    if (routeHistory.length > 1) routeHistory.pop();
    const place = routeHistory.at(-1) ?? { route: 'home' as const, appId: null };
    if (place.route === cur.route && place.appId === cur.appId && cur.route !== 'home') {
      routeHistory.splice(0, routeHistory.length, { route: 'home', appId: null });
      set({ route: 'home', navDir: -1, appId: null, editing: false, quickPanel: false });
      return;
    }
    set({ route: place.route, navDir: -1, appId: place.appId, quickPanel: false, editing: place.route === 'home' ? cur.editing : false });
  },
  setQuickPanel: (quickPanel) => set({ quickPanel }),
  setStandby: (standby) => set({ standby, quickPanel: false }),
  setMusicTab: (musicTab) => set({ musicTab }),
  setPassenger: (passenger) => set({ passenger }),
  showToast(message) {
    window.clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = window.setTimeout(() => set({ toast: null }), 2600);
  },
  setPage: (pageId) => set({ pageId }),
  setEditing: (editing) => set({ editing }),
  setNavEditor: (navEditor) => set({ navEditor, quickPanel: false }),
  setNavDraft: (navDraft) => set({ navDraft }),
  setLocalNowPlaying(now) {
    const was = get().localNowPlaying;
    if (JSON.stringify(was) === JSON.stringify(now)) return;
    set({ localNowPlaying: now });
  },
  localMedia_cmd(action) {
    const source = get().localNowPlaying?.source;
    if (!source) return;
    window.dispatchEvent(new CustomEvent('headunit:local-media-command', { detail: { source, action } }));
  },

  media_cmd: (command) => socket?.send({ t: 'media', command }),
  projection_cmd: (command) => socket?.send({ t: 'projection', command }),
  androidAutoDev_cmd: (command) => socket?.send({ t: 'android-auto-dev', command }),
  device_cmd: (command) => socket?.send({ t: 'device', command }),
  radio_cmd: (command) => socket?.send({ t: 'radio', command }),
  camera_cmd: (command) => socket?.send({ t: 'camera', command }),
  diagnostics_cmd: (command) => socket?.send({ t: 'diagnostics', command }),

  patchSystem(p) {
    const s = get().system;
    if (s) set({ system: { ...s, ...p } }); // optimistic; server echoes the truth
    socket?.send({ t: 'system', patch: p });
  },

  patchSettings(patch) {
    // The navigation, launcher and Quick Panel arrangements need the head unit to keep them: offline the change would look applied and then
    // quietly revert on reconnect. Say so instead.
    if (('nav' in patch || 'launcher' in patch || 'panel' in patch) && get().conn !== 'open') {
      get().showToast('Reconnect to the head unit to change this');
      return;
    }
    const s = get().settings;
    // The same rules the server applies, so what this screen shows now is what the server will keep (and an invalid value never flashes).
    if (s) set({ settings: mergeSettings(s, patch) });
    socket?.send({ t: 'settings', patch });
  },

  setLayout(layout) {
    if (!sanitizeLayout(layout)) {
      console.warn('[layout] refused an invalid layout', layout);
      return;
    }
    set({ layout });
    // Debounce: dragging emits many intermediate layouts.
    window.clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => socket?.send({ t: 'layout', data: layout }), 350);
  },
}));

/** The slice of the store the art selectors read (so tests can pass a plain object). */
export type ArtState = Pick<HeadUnit, 'radio' | 'media' | 'localNowPlaying'> & Pick<Partial<HeadUnit>, 'devices'>;

/**
 * Cover art of the current track: while a page with its own player (YouTube Music, native TIDAL) has a track selected, that track's
 * art (none if it has none: the server's media track is then a paused, stale one and its cover is not what is audible);
 * otherwise the server's media track.
 */
export function selectTrackArt(s: ArtState): string | undefined {
  if (s.localNowPlaying) return s.localNowPlaying.artUrl || undefined;
  const bt = s.devices?.media;
  if (bt && (bt.status === 'playing' || bt.status === 'paused') && !s.media?.playing) return bt.artUrl || undefined;
  return s.media?.track?.artUrl || undefined;
}

/**
 * The picture the Backdrop shows (a plain string, so a zustand subscription only re-renders when the picture actually changes):
 * while radio is playing, the station's logo (nothing when it has none: the cover of whatever played last is not what is audible);
 * otherwise the local player's art, then the media track's.
 */
export function selectBackdropArt(s: ArtState): string | undefined {
  const radio = s.radio;
  if (radio?.playing) return radio.stations.find((st) => st.id === radio.stationId)?.logo || undefined;
  return selectTrackArt(s);
}

/** Applies one server message to the store (exported for tests; the socket is its only caller). */
export function apply(m: ServerMessage) {
  const st = useHeadUnit.getState();
  switch (m.t) {
    case 'snapshot': {
      const keepPage = m.layout.pages.some((p) => p.id === st.pageId);
      // Whatever the server sent, the screen works with a complete, valid Settings: a server from before the navigation settings existed
      // (a rollback, a page left open across an update) simply gets the defaults for the missing parts instead of a blank screen.
      const settings = sanitizeSettings(m.settings);
      useHeadUnit.setState({
        ready: true,
        snapshots: st.snapshots + 1,
        settings,
        layout: m.layout,
        vehicle: m.vehicle,
        media: m.media,
        system: m.system,
        projection: m.projection,
        androidAutoDev: m.androidAutoDev,
        devices: m.devices,
        radio: m.radio,
        camera: m.camera,
        diagnostics: m.diagnostics,
        svc: m.svc ?? {},
        demo: m.demo === true,
        // Open Music on whichever source is actually playing, else the saved one. Only the first snapshot decides: a reconnect must
        // not yank the tab the user is on (radio can play while another tab is open).
        musicTab: st.ready ? st.musicTab : initialMusicTab({ radioPlaying: m.radio.playing, musicSource: settings.musicSource, provider: m.media.provider, current: st.musicTab }),
        pageId: keepPage ? st.pageId : m.layout.pages[0]!.id,
      });
      break;
    }
    case 'vehicle':
      useHeadUnit.setState({ vehicle: m.data });
      break;
    case 'media':
      useHeadUnit.setState({ media: m.data });
      break;
    case 'system':
      useHeadUnit.setState({ system: m.data });
      break;
    case 'projection':
      useHeadUnit.setState({ projection: m.data });
      break;
    case 'android-auto-dev':
      useHeadUnit.setState({ androidAutoDev: m.data });
      break;
    case 'devices':
      useHeadUnit.setState({ devices: m.data });
      break;
    case 'radio':
      useHeadUnit.setState({ radio: m.data });
      break;
    case 'camera':
      useHeadUnit.setState({ camera: m.data });
      break;
    case 'diagnostics':
      useHeadUnit.setState({ diagnostics: m.data });
      break;
    case 'svc':
      // `name` and `data` always agree (the server sends them as a pair), so the cast only satisfies the compiler.
      useHeadUnit.setState({ svc: { ...st.svc, [m.name]: m.data } as Partial<ServiceMap> });
      break;
    case 'hardware':
      window.dispatchEvent(new CustomEvent('headunit:hardware-control', { detail: m.data }));
      break;
    case 'settings':
      useHeadUnit.setState({ settings: sanitizeSettings(m.data) });
      break;
    case 'layout': {
      // Another screen edited the layout — don't yank it out from under an active edit.
      if (st.editing) break;
      const keepPage = m.data.pages.some((p) => p.id === st.pageId);
      useHeadUnit.setState({ layout: m.data, pageId: keepPage ? st.pageId : m.data.pages[0]!.id });
      break;
    }
  }
}

export function startSocket() {
  if (socket) return;
  socket = connectSocket(apply, (conn) => useHeadUnit.setState({ conn }));
}

/** One named service from the server (GPS, trips, garage, ...); undefined until its first snapshot arrives. */
export function useSvc<K extends ServiceName>(name: K): ServiceMap[K] | undefined {
  return useHeadUnit((s) => s.svc[name]) as ServiceMap[K] | undefined;
}
