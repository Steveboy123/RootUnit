import type {
  AlbumMotion,
  Background,
  BeatColorMode,
  BeatMode,
  BeatSource,
  DashScene,
  DepthStyle,
  DockStyle,
  Effects,
  FontId,
  GaugeStyle,
  GlassFinish,
  MascotAura,
  MascotMotion,
  MascotVariant,
  MotionSpeed,
  PageTransition,
  Shape,
  StandbyStyle,
  Surface,
  ThemeId,
  TouchFx,
} from './appearance';
import type { ServiceMap, ServiceMessage } from './features';
import { DEFAULT_LAUNCHER, DEFAULT_NAV, DEFAULT_PANEL, type LauncherConfig, type NavConfig, type NavPatch, type PanelConfig } from './nav';

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export interface TripStats {
  distanceKm: number;
  durationS: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
}

/** The numeric readings a car may or may not provide. */
export type VehicleKey =
  | 'speedKmh'
  | 'rpm'
  | 'coolantC'
  | 'intakeC'
  | 'ambientC'
  | 'throttlePct'
  | 'loadPct'
  | 'fuelPct'
  | 'batteryV';

export interface VehicleLink {
  /** connecting: opening the adapter / finding the car · ecu-off: adapter OK but the car isn't answering (ignition off?) */
  status: 'connecting' | 'live' | 'ecu-off' | 'error';
  detail?: string;
  adapter?: string;
  protocol?: string;
}

export interface VehicleState {
  /** Real vehicle data is read from the configured OBD-II adapter. `sim` only exists in explicit demo mode (HEADUNIT_DEMO=1). */
  source: 'obd' | 'sim';
  /** False while there is no live data — gauges must not show stale numbers as if they were live. */
  connected: boolean;
  /** OBD adapter/ECU connection details. */
  link?: VehicleLink;
  /** Readings this car doesn't provide; show "—", never a made-up value. */
  unsupported?: VehicleKey[];
  /** Check-engine light and the number of stored fault codes, when known. */
  mil?: { on: boolean; count: number };
  speedKmh: number;
  rpm: number;
  coolantC: number;
  intakeC: number;
  ambientC: number;
  throttlePct: number;
  loadPct: number;
  fuelPct: number;
  batteryV: number;
  trip: TripStats;
}

// ---------------------------------------------------------------------------
// Diagnostics (fault codes)
// ---------------------------------------------------------------------------

export interface Dtc {
  /** e.g. "P0420" */
  code: string;
  kind: 'stored' | 'pending';
  /** Only for well-known generic codes; manufacturer codes have none. */
  description?: string;
}

export interface DiagnosticsState {
  status: 'idle' | 'reading' | 'clearing' | 'error';
  codes: Dtc[];
  /** Epoch ms of the last successful read, or null if never read. */
  readAt: number | null;
  error?: string;
}

export type DiagnosticsCommand = 'read' | 'clear';

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaTrack {
  id: string;
  /** Service URI (spotify:track:…) — lets the UI like or queue the current track. */
  uri?: string;
  title: string;
  artist: string;
  album: string;
  artUrl?: string;
  durationMs: number;
}

export type MediaStatus = 'ready' | 'needs-auth' | 'no-device' | 'error';
export type RepeatMode = 'off' | 'track' | 'context';

export interface MediaState {
  /** `mock` is the offline demo player, present only in explicit demo mode (HEADUNIT_DEMO=1). */
  provider: 'spotify' | 'tidal' | 'mock';
  status: MediaStatus;
  playing: boolean;
  track: MediaTrack | null;
  /** Progress at the moment `progressTs` was sampled (server clock, epoch ms). */
  progressMs: number;
  progressTs: number;
  /** Player volume, 0–100. */
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  deviceName?: string;
  /** Is the current track in the user's library ("liked")? Unknown until checked. */
  liked?: boolean;
  error?: string;
}

export interface Playlist {
  id: string;
  uri: string;
  name: string;
  trackCount: number;
  artUrl?: string;
}

export type MediaCommand =
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'toggle' }
  | { cmd: 'next' }
  | { cmd: 'prev' }
  | { cmd: 'seek'; positionMs: number }
  | { cmd: 'volume'; volume: number }
  | { cmd: 'shuffle'; enabled: boolean }
  | { cmd: 'repeat'; mode: RepeatMode }
  | { cmd: 'playContext'; uri: string; offset?: number }
  /** Play these tracks, starting at `offset`. */
  | { cmd: 'playTracks'; uris: string[]; offset?: number }
  /** Add a track to the end of the queue. */
  | { cmd: 'queueAdd'; uri: string };

// ---------------------------------------------------------------------------
// Music library shared by Spotify and TIDAL providers.
// ---------------------------------------------------------------------------

export interface CatalogTrack {
  id: string;
  /** Service URI, e.g. spotify:track:… — what the player is asked to play. */
  uri: string;
  title: string;
  artist: string;
  album: string;
  artUrl?: string;
  durationMs: number;
  /**
   * Index of this track in its playlist/album *as the service numbers it* (before unplayable or local
   * entries were dropped from the list), so "play from here" can start the right one.
   */
  position?: number;
  /** False when the service says the track can't be played (region, plan, removed). Undefined = unknown/yes. */
  playable?: boolean;
  explicit?: boolean;
}

export interface CatalogItem {
  id: string;
  uri: string;
  type: 'playlist' | 'album' | 'artist';
  name: string;
  subtitle?: string;
  artUrl?: string;
  trackCount?: number;
}

export interface LibraryHome {
  recent: CatalogTrack[];
  topTracks: CatalogTrack[];
  topArtists: CatalogItem[];
  playlists: CatalogItem[];
}

export interface SearchResults {
  tracks: CatalogTrack[];
  albums: CatalogItem[];
  artists: CatalogItem[];
  playlists: CatalogItem[];
}

export interface TrackListing {
  item: CatalogItem;
  tracks: CatalogTrack[];
}

export interface QueueView {
  current: CatalogTrack | null;
  next: CatalogTrack[];
}

/** Somewhere playback can happen: this unit, a phone, a smart speaker… (Spotify Connect). */
export interface ConnectDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

/** Error body of the /api/library routes. `scope` = the user must reconnect to grant new permissions. */
export interface LibraryErrorBody {
  error: string;
  code?: 'scope' | 'auth' | 'rate' | 'unavailable';
}

// ---------------------------------------------------------------------------
// System (volume, brightness)
// ---------------------------------------------------------------------------

export interface AudioOutput {
  /** PipeWire node id (what `wpctl set-default` takes). */
  id: number;
  name: string;
  isDefault: boolean;
}

export interface SystemState {
  platform: string;
  /** Sound outputs (e.g. the RCA audio HAT, HDMI, headphones). Empty if they can't be listed. */
  outputs: AudioOutput[];
  /** System output volume, 0–100. */
  volume: number;
  muted: boolean;
  /** Backlight level, 5–100. */
  brightness: number;
  /** True if the server can drive a real backlight; otherwise the UI dims itself in software. */
  hardwareBrightness: boolean;
}

export interface SystemPatch {
  /** Make this output the default. */
  output?: number;
  volume?: number;
  muted?: boolean;
  brightness?: number;
}

// ---------------------------------------------------------------------------
// Projection (Android Auto / CarPlay)
// ---------------------------------------------------------------------------

export type ProjectionStatus = 'unavailable' | 'idle' | 'starting' | 'active' | 'error';

export type AndroidAutoDevPhoneState = 'missing-adb' | 'disconnected' | 'unauthorized' | 'offline' | 'ready';
export type AndroidAutoDevBridgeState = 'idle' | 'connecting' | 'active' | 'error';

export interface AndroidAutoDevState {
  /** Developer Head Unit Server bridge is available on the Linux/Raspberry Pi build. */
  enabled: boolean;
  adbInstalled: boolean;
  phoneState: AndroidAutoDevPhoneState;
  phoneSerial?: string;
  phoneModel?: string;
  /** How ADB currently reaches the phone. Wi-Fi is preferred; USB is the fallback. */
  transport?: 'wifi' | 'usb';
  /** Last/active Android wireless-debugging endpoint, e.g. 192.168.43.1:37123. */
  wifiEndpoint?: string;
  /** Phone hotspot gateway detected from the Pi's default route. Useful when mDNS is blocked by tethering. */
  hotspotGateway?: string;
  /** ADB mDNS found a paired wireless-debugging connect service. */
  wifiDiscovered: boolean;
  /** True once adb has a tcp:5277 forward for the selected phone. */
  forwardReady: boolean;
  /** Native receiver TCP endpoint this bridge feeds (OpenAuto Prodigy normally listens on 5288). */
  receiverPort: number;
  bridgeState: AndroidAutoDevBridgeState;
  detail?: string;
}

export type AndroidAutoDevCommand = 'refresh' | 'connect' | 'disconnect';

export interface ProjectionState {
  provider: 'external';
  /**
   * ondemand: the app is started when you tap Launch and killed on Stop (wired USB).
   * resident: the app runs all the time (wireless Android Auto must be listening for the phone);
   *           Launch/Stop only bring its window to the front / send it back.
   */
  mode: 'ondemand' | 'resident';
  /** Is the projection app process alive? */
  running: boolean;
  status: ProjectionStatus;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  theme: ThemeId;
  /** Accent colour as #rrggbb. */
  accent: string;
  /** Card style: solid (default), glass, outline or neon. */
  surface: Surface;
  /** What is drawn behind the app (`none` = just the palette gradient). */
  background: Background;
  /** GPU budget for blur and animation. */
  effects: Effects;
  /** Artwork visual: square, vinyl record, floating cover, or holographic sleeve. */
  albumMotion: AlbumMotion;
  /** Depth treatment of panels and cards. */
  depthStyle: DepthStyle;
  /** Decorative animation intensity. Off disables motion while retaining 3D styling. */
  motionSpeed: MotionSpeed;
  /** Scene behind Home widgets, disabled when driving or reduce motion is requested. */
  dashScene: DashScene;
  /** Layered-glass treatment for raised dashboard cards. */
  glassFinish: GlassFinish;
  /** Reactive overlay is ABOVE any chosen background and BELOW all buttons. */
  beatMode: BeatMode;
  /** ALSA loopback capture on the Pi, or microphone capture after explicit consent. */
  beatSource: BeatSource;
  beatColorMode: BeatColorMode;
  /** Custom reactive tint (separate from the interface accent). */
  beatColor: string;
  beatIntensity: number;
  beatSensitivity: number;
  /** Independent mascot overlay; never replaces your selected wallpaper or album-art backdrop. */
  mascotEnabled: boolean;
  mascotVariant: MascotVariant;
  mascotMotion: MascotMotion;
  /** Light drawn around the mascot. */
  mascotAura: MascotAura;
  mascotPlacement: 'behind' | 'front';
  mascotScope: 'home' | 'all';
  mascotX: number;
  mascotY: number;
  mascotSize: number;
  mascotOpacity: number;
  mascotGlow: number;
  mascotBeat: boolean;
  mascotMirror: boolean;
  /** Corner radius family. */
  shape: Shape;
  /** Backdrop blur radius, px (APPEARANCE_RANGES.bgBlur). */
  bgBlur: number;
  /** Backdrop dimming, % (APPEARANCE_RANGES.bgDim). The UI never goes below the palette's own minimum. */
  bgDim: number;
  /** Glass see-through amount, % (APPEARANCE_RANGES.glassOpacity). */
  glassOpacity: number;
  /** Wallpaper id for `background: 'wallpaper'`: a built-in scene or `user:<file>` (WALLPAPER_ID_RE). */
  wallpaper: string;
  /** Typeface of the interface (all bundled, nothing is downloaded). */
  font: FontId;
  /** Text size, % (APPEARANCE_RANGES.textScale). */
  textScale: number;
  /** How one screen hands over to the next. */
  transition: PageTransition;
  /** Feedback drawn when a button is pressed. */
  touchFx: TouchFx;
  /** How the speedometer and tachometer are drawn. */
  gaugeStyle: GaugeStyle;
  /** What the standby screen shows. */
  standbyStyle: StandbyStyle;
  /** How the navigation dock is drawn. */
  dockStyle: DockStyle;
  /** How busy the animated background scene is, % (APPEARANCE_RANGES.sceneIntensity). */
  sceneIntensity: number;
  /** Let the real weather add to the scene: rain, snow, fog or a starry sky. Needs the weather to be on. */
  weatherFx: boolean;
  units: 'metric' | 'imperial';
  clock24h: boolean;
  /** Switch between dayTheme and nightTheme on a schedule (overrides `theme`). */
  autoTheme: boolean;
  dayTheme: ThemeId;
  nightTheme: ThemeId;
  /** Local time, "HH:MM". Night runs from nightStart to nightEnd, wrapping past midnight. */
  nightStart: string;
  nightEnd: string;
  /** Reverse-camera options. */
  cameraMirror: boolean;
  cameraGuides: boolean;
  /** Tint the interface with the colour of the album art that's playing. */
  artAccent: boolean;
  /** Lock text entry (search, adding stations) while the car is moving. */
  lockWhileDriving: boolean;
  /**
   * Which real music service the Music page and widgets use. `auto` selects the first connected/configured service.
   * Services are never mixed: exactly one is active at a time.
   */
  musicSource: MusicSource;
  /** How `autoTheme` decides: by the `nightStart`/`nightEnd` clock, or by the real sunrise and sunset where the car is. */
  autoThemeMode: 'schedule' | 'sun';
  /** Show the weather (fetched from open-meteo.com for the car's position, rounded to about 1 km). */
  weather: boolean;
  /** Show synced lyrics (the track's title, artist and length are looked up on lrclib.net). Off until the driver asks. */
  lyrics: boolean;
  /** Open the Drive screen by itself when the car gets moving. */
  driveAuto: boolean;
  /** Show the standby clock after this many idle minutes while parked (0 = never). */
  standbyMin: number;
  /** The navigation rail: which items, in what order, where, how big, with which labels. */
  nav: NavConfig;
  /** Which apps the Apps launcher hides. */
  launcher: LauncherConfig;
  /** Which tiles and sections the Quick Panel shows. (Not `quickPanel`: that name is the open/closed flag in the UI store.) */
  panel: PanelConfig;
}

/** What a client may send to change settings: any subset, with the three arrangements as (partial) objects that carry their `version`. */
export type SettingsPatch = Omit<Partial<Settings>, 'nav' | 'launcher' | 'panel'> & {
  nav?: NavPatch;
  launcher?: { readonly version: 1 } & Partial<Omit<LauncherConfig, 'version'>>;
  panel?: { readonly version: 1 } & Partial<Omit<PanelConfig, 'version'>>;
};

export type MusicSource = 'auto' | 'spotify' | 'tidal';
export const MUSIC_SOURCES: MusicSource[] = ['auto', 'spotify', 'tidal'];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'obsidian',
  accent: '#a66bff',
  surface: 'glass',
  background: 'mesh',
  effects: 'balanced',
  albumMotion: 'vinyl',
  depthStyle: 'soft',
  motionSpeed: 'calm',
  dashScene: 'particles',
  glassFinish: 'frosted',
  beatMode: 'off',
  beatSource: 'system',
  beatColorMode: 'album',
  beatColor: '#7c5cff',
  beatIntensity: 55,
  beatSensitivity: 55,
  mascotEnabled: true,
  mascotVariant: 'transparent',
  mascotMotion: 'float',
  mascotAura: 'glow',
  mascotPlacement: 'behind',
  mascotScope: 'home',
  mascotX: 78,
  mascotY: 51,
  mascotSize: 37,
  mascotOpacity: 72,
  mascotGlow: 45,
  mascotBeat: false,
  mascotMirror: false,
  shape: 'soft',
  bgBlur: 28,
  bgDim: 45,
  glassOpacity: 50,
  wallpaper: 'night-road',
  font: 'inter',
  textScale: 100,
  transition: 'depth',
  touchFx: 'ripple',
  gaugeStyle: 'arc',
  standbyStyle: 'clock',
  dockStyle: 'island',
  sceneIntensity: 60,
  weatherFx: false,
  units: 'metric',
  clock24h: true,
  autoTheme: false,
  dayTheme: 'daylight',
  nightTheme: 'midnight',
  nightStart: '19:00',
  nightEnd: '06:30',
  cameraMirror: false,
  cameraGuides: true,
  artAccent: true,
  lockWhileDriving: true,
  musicSource: 'auto',
  autoThemeMode: 'schedule',
  weather: true,
  lyrics: false,
  driveAuto: false,
  standbyMin: 0,
  nav: DEFAULT_NAV,
  launcher: DEFAULT_LAUNCHER,
  panel: DEFAULT_PANEL,
};

/** Above this speed (km/h) the car counts as "driving" for the text-entry lockout. */
export const DRIVING_SPEED_KMH = 8;

// ---------------------------------------------------------------------------
// Music service connections (Client ID, sign-in state) — Settings → Music services
// ---------------------------------------------------------------------------

export type MusicService = 'spotify' | 'tidal';
export const MUSIC_SERVICES: MusicService[] = ['spotify', 'tidal'];

export type ConnectionProblem =
  /** The saved sign-in no longer works (Spotify sign-ins also expire after about six months). */
  | 'login-expired'
  /** Signed in, but the app wasn't granted a permission this feature needs. */
  | 'permissions'
  /** The service refused the app itself (wrong Client ID, redirect URI not registered, app not allowed). */
  | 'rejected';

/** What Settings shows for one service. Never contains tokens or secrets. */
export interface ServiceConnection {
  service: MusicService;
  /** "Spotify" / "TIDAL". */
  label: string;
  /** Is this service implemented in this build? (UI shows "not available yet" otherwise.) */
  available: boolean;
  /** Required developer credentials are available for this service. */
  configured: boolean;
  clientId: string;
  clientIdSource: 'saved' | 'env' | 'none';
  /** TIDAL catalog access also needs a Client Secret. The secret itself is never returned to the browser. */
  clientSecretConfigured?: boolean;
  clientSecretSource?: 'saved' | 'env' | 'none';
  /** Where to create the developer app. */
  dashboardUrl: string;
  /** The exact Redirect URI to register in that dashboard. */
  redirectUri: string;
  redirectUriSource: 'default' | 'saved' | 'env';
  /** Permissions that will be requested at the next sign-in (space-separated), where they can be changed (TIDAL). */
  requestedScopes?: string;
  /** Signed in with a token we believe is still usable. */
  connected: boolean;
  /** A sign-in is in progress (login link issued, waiting for the redirect / pasted address). */
  loginPending: boolean;
  problem?: ConnectionProblem;
  /** Plain-language explanation for `problem`, or a hint for the next step. */
  message?: string;
  /** Epoch ms of the last successful sign-in. */
  connectedAt?: number;
  /** Epoch ms when the sign-in is expected to lapse (Spotify: about six months after approval), if known. */
  loginExpiresAt?: number;
  scopes?: string[];
}

export interface ConnectionsResponse {
  services: ServiceConnection[];
}

/** PUT /api/connections/:service */
export interface SaveConnectionRequest {
  clientId: string;
  /** TIDAL only. Stored server-side and never returned by the API. `null`/'' removes the saved secret. */
  clientSecret?: string | null;
  /** Advanced: a different Redirect URI than the default. `null`/'' = back to default. */
  redirectUri?: string | null;
  /** Advanced (TIDAL): the permissions to ask for, space-separated. `null`/'' = the built-in default. */
  scopes?: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Devices (phones & other paired devices)
// ---------------------------------------------------------------------------

export type DeviceTransport = 'usb' | 'wifi' | 'bluetooth';

export interface PhoneDevice {
  /** Stable Bluetooth device id/address. */
  id: string;
  name: string;
  platform: 'android' | 'ios' | 'other';
  connected: boolean;
  /** The phone whose session (audio / projection) is currently in use. */
  active: boolean;
  /** How it's connected right now, e.g. ['bluetooth', 'wifi'] for wireless Android Auto. */
  transports: DeviceTransport[];
  /** Unknown when the phone doesn't report it — never invent a value. */
  battery?: { percent: number; charging?: boolean };
  /** 0–4 bars. */
  signal?: number;
  carrier?: string;
  projection?: 'android-auto' | 'carplay' | null;
}

export interface BluetoothMediaState {
  /** Phone that owns the AVRCP/A2DP session, when BlueZ exposes it. */
  deviceId?: string;
  deviceName?: string;
  status: 'idle' | 'playing' | 'paused' | 'stopped';
  title?: string;
  artist?: string;
  album?: string;
  artUrl?: string;
  durationMs?: number;
  positionMs?: number;
  /** Negotiated PipeWire/BlueZ codec when it can be determined (aac, sbc_xq, sbc, …). */
  codec?: string;
  /** True when the Pi has created a loopback from the phone's A2DP source to the default head-unit output. */
  routed?: boolean;
}

export interface DevicesState {
  /** `sim` only exists in explicit demo mode (HEADUNIT_DEMO=1). */
  source: 'bluez' | 'sim';
  devices: PhoneDevice[];
  /** AVRCP metadata from the active Bluetooth phone. Missing when the phone does not expose a media player. */
  media?: BluetoothMediaState;
  error?: string;
}

export type DeviceCommand =
  | { cmd: 'activate'; id: string }
  | { cmd: 'connect'; id: string }
  | { cmd: 'disconnect'; id: string }
  | { cmd: 'media'; action: 'toggle' | 'play' | 'pause' | 'next' | 'prev'; id?: string };

/** A media/rotary-key event read from Linux /dev/input. Volume/mute stay owned by the OS; these are navigation/media actions only. */
export interface HardwareControlEvent {
  action: 'next' | 'prev' | 'toggle';
  at: number;
}

// ---------------------------------------------------------------------------
// Radio
// ---------------------------------------------------------------------------

export interface RadioStation {
  id: string;
  name: string;
  /** Stream URL (http/https). For fm/dab this is the local tuner's stream. */
  url: string;
  kind: 'internet' | 'fm' | 'dab';
  genre?: string;
  logo?: string;
}

export interface RadioState {
  status: 'idle' | 'connecting' | 'playing' | 'error';
  /** Intent: should radio be audible? */
  playing: boolean;
  stationId: string | null;
  /** Live "now playing" text from the stream (ICY StreamTitle). */
  nowPlaying?: string;
  error?: string;
  /** Bumps on every (re)start so the player reconnects. */
  session: number;
  stations: RadioStation[];
  favorites: string[];
}

export type RadioCommand =
  | { cmd: 'play'; id?: string }
  | { cmd: 'stop' }
  | { cmd: 'toggle' }
  | { cmd: 'next' }
  | { cmd: 'prev' }
  | { cmd: 'favorite'; id: string; on: boolean }
  | { cmd: 'add'; name: string; url: string; genre?: string; logo?: string }
  | { cmd: 'remove'; id: string };

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface CameraState {
  active: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard layout
// ---------------------------------------------------------------------------

export type WidgetConfig = Record<string, string | number | boolean>;

export interface WidgetInstance {
  id: string;
  /** Key into the UI widget registry. */
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: WidgetConfig;
}

export interface DashboardPage {
  id: string;
  name: string;
  widgets: WidgetInstance[];
}

export interface DashboardLayout {
  version: 1;
  pages: DashboardPage[];
}

/** The dashboard grid is always this many cells; cell size follows the screen. */
export const GRID_COLS = 12;
export const GRID_ROWS = 6;

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  pages: [
    {
      id: 'drive',
      name: 'Drive',
      widgets: [
        { id: 'w-speed', type: 'speedometer', x: 0, y: 0, w: 4, h: 4 },
        { id: 'w-media', type: 'nowPlaying', x: 4, y: 0, w: 5, h: 4 },
        { id: 'w-clock', type: 'clock', x: 9, y: 0, w: 3, h: 2 },
        { id: 'w-quick', type: 'quickControls', x: 9, y: 2, w: 3, h: 2 },
        { id: 'w-trip', type: 'trip', x: 0, y: 4, w: 4, h: 2 },
        { id: 'w-launch', type: 'launcher', x: 4, y: 4, w: 5, h: 2 },
        { id: 'w-fuel', type: 'gauge', x: 9, y: 4, w: 3, h: 2, config: { metric: 'fuel' } },
      ],
    },
    {
      id: 'engine',
      name: 'Engine',
      widgets: [
        { id: 'e-rpm', type: 'tachometer', x: 0, y: 0, w: 5, h: 4 },
        { id: 'e-speed', type: 'speedometer', x: 5, y: 0, w: 4, h: 4 },
        { id: 'e-coolant', type: 'gauge', x: 9, y: 0, w: 3, h: 2, config: { metric: 'coolant' } },
        { id: 'e-batt', type: 'gauge', x: 9, y: 2, w: 3, h: 2, config: { metric: 'battery' } },
        { id: 'e-load', type: 'gauge', x: 0, y: 4, w: 3, h: 2, config: { metric: 'load' } },
        { id: 'e-throttle', type: 'gauge', x: 3, y: 4, w: 3, h: 2, config: { metric: 'throttle' } },
        { id: 'e-intake', type: 'gauge', x: 6, y: 4, w: 3, h: 2, config: { metric: 'intake' } },
        { id: 'e-media', type: 'nowPlaying', x: 9, y: 4, w: 3, h: 2 },
      ],
    },
    {
      id: 'today',
      name: 'Today',
      widgets: [
        { id: 't-weather', type: 'weather', x: 0, y: 0, w: 3, h: 2 },
        { id: 't-trips', type: 'tripsToday', x: 3, y: 0, w: 3, h: 2 },
        { id: 't-find', type: 'findCar', x: 6, y: 0, w: 3, h: 2 },
        { id: 't-timers', type: 'timers', x: 9, y: 0, w: 3, h: 2 },
        { id: 't-garage', type: 'garage', x: 0, y: 2, w: 5, h: 2 },
        { id: 't-system', type: 'system', x: 5, y: 2, w: 3, h: 2 },
        { id: 't-media', type: 'nowPlaying', x: 8, y: 2, w: 4, h: 4 },
        { id: 't-scenes', type: 'scenes', x: 0, y: 4, w: 5, h: 2 },
        { id: 't-actions', type: 'quickActions', x: 5, y: 4, w: 3, h: 2 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export interface Snapshot {
  settings: Settings;
  layout: DashboardLayout;
  vehicle: VehicleState;
  media: MediaState;
  system: SystemState;
  projection: ProjectionState;
  androidAutoDev: AndroidAutoDevState;
  devices: DevicesState;
  radio: RadioState;
  camera: CameraState;
  diagnostics: DiagnosticsState;
  /** Everything in the ServiceMap the server currently has (GPS, trips, garage, weather, ...). */
  svc: Partial<ServiceMap>;
  /** True only when the server runs with simulated hardware (HEADUNIT_DEMO=1): the UI labels everything as a demo. */
  demo?: boolean;
}

export type ServerMessage =
  | ({ t: 'snapshot' } & Snapshot)
  | { t: 'vehicle'; data: VehicleState }
  | { t: 'media'; data: MediaState }
  | { t: 'system'; data: SystemState }
  | { t: 'projection'; data: ProjectionState }
  | { t: 'android-auto-dev'; data: AndroidAutoDevState }
  | { t: 'devices'; data: DevicesState }
  | { t: 'radio'; data: RadioState }
  | { t: 'camera'; data: CameraState }
  | { t: 'diagnostics'; data: DiagnosticsState }
  | { t: 'settings'; data: Settings }
  | { t: 'layout'; data: DashboardLayout }
  | { t: 'hardware'; data: HardwareControlEvent }
  | ServiceMessage;

export type ClientMessage =
  | { t: 'media'; command: MediaCommand }
  | { t: 'system'; patch: SystemPatch }
  | { t: 'settings'; patch: SettingsPatch }
  | { t: 'layout'; data: DashboardLayout }
  | { t: 'projection'; command: 'launch' | 'stop' }
  | { t: 'android-auto-dev'; command: AndroidAutoDevCommand }
  | { t: 'device'; command: DeviceCommand }
  | { t: 'radio'; command: RadioCommand }
  | { t: 'camera'; command: 'show' | 'hide' | 'toggle' }
  | { t: 'diagnostics'; command: DiagnosticsCommand };
