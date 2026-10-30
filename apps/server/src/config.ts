import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFmConfig } from './fm/config';
import { splitCommand } from './shellwords';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');

const env = process.env;

const projectionOverride = (env.PROJECTION_COMMAND ?? '').trim();
const projectionCommand = projectionOverride;
// v0.3.9+: never let a stale PROJECTION_MODE=resident from older installs put OpenAuto over the dashboard at boot.
const projectionMode = env.HEADUNIT_ALLOW_RESIDENT_AA === '1' && env.PROJECTION_MODE === 'resident' ? 'resident' : 'ondemand';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};
// Demo mode (--demo) keeps its own folder, so simulated trips and a made-up garage can never mix with a real head unit's data.
const dataDir = resolve(env.HEADUNIT_DATA_DIR ?? resolve(repoRoot, process.argv.includes('--demo') ? 'data-demo' : 'data'));

export const config = {
  host: env.HOST ?? '127.0.0.1',
  port: num(env.PORT, 8787),
  /** Where the browser reaches the UI after OAuth (dev: Vite, prod: this server). */
  uiUrl: env.HEADUNIT_UI_URL ?? (env.NODE_ENV === 'production' ? '/?kiosk=1' : '/'),
  dataDir,
  sensorToken: env.HEADUNIT_SENSOR_TOKEN?.trim() || '',
  projectDir: repoRoot,
  updater: {
    helper: env.HEADUNIT_UPDATE_HELPER ?? '/usr/local/sbin/headunit-update',
    uploadDir: resolve(repoRoot, 'data/updates'),
    /** Easy updater: newest RPI-head-unit*.zip downloaded by Chromium on the Pi. */
    downloadDir: resolve(env.HEADUNIT_UPDATE_DOWNLOAD_DIR?.trim() || resolve(homedir(), 'Downloads')),
    enabled: process.platform === 'linux',
  },
  /** Images dropped here (png, jpg, webp, avif) can be picked as the app wallpaper. Never created by the server. */
  wallpapersDir: resolve(env.HEADUNIT_WALLPAPER_DIR?.trim() || resolve(dataDir, 'wallpapers')),
  uiDist: resolve(env.HEADUNIT_UI_DIST ?? resolve(repoRoot, 'apps/ui/dist')),
  /** Extra hostnames (besides loopback) allowed in Host/Origin when HOST is not loopback. */
  allowedHosts: (env.HEADUNIT_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** This build has no demo/simulator runtime. Vehicle data is always read from OBD-II. */
  obd: {
    /** /dev/rfcomm0 (paired Bluetooth adapter on the Pi), COM5 (Windows), /dev/ttyUSB0, or tcp://host:port (Wi-Fi adapter / emulator). */
    port: env.OBD_PORT ?? (process.platform === 'linux' ? '/dev/rfcomm0' : ''),
    baud: num(env.OBD_BAUD, 38400),
  },
  // `clientId` / `redirectUri` below are only the ENVIRONMENT layer: connections/credentials.ts resolves them against
  // what the user saved in Settings (saved > environment > built-in default). Empty = not set in the environment.
  spotify: {
    clientId: env.SPOTIFY_CLIENT_ID ?? '',
    /** Spotify requires https or a loopback IP literal (not "localhost"). The default is built from `port` when this is empty. */
    redirectUri: env.SPOTIFY_REDIRECT_URI ?? '',
    /** Name of the Spotify Connect device on this Pi (raspotify/librespot `--name`). */
    deviceName: env.SPOTIFY_DEVICE_NAME ?? 'RPI Headunit',
    pollMs: num(env.SPOTIFY_POLL_MS, 3000),
    /** Local Spotify Connect receiver bundled into Pi builds from Raspotify/librespot. */
    // Native librespot is the primary Pi player; the official Web Playback SDK remains a UI fallback.
    connectEnabled: process.platform === 'linux' && env.SPOTIFY_CONNECT_DISABLED !== '1',
    connectBinary: resolve(env.SPOTIFY_CONNECT_BINARY?.trim() || resolve(repoRoot, 'vendor/spotify-connect/librespot')),
    connectBackend: env.SPOTIFY_CONNECT_BACKEND?.trim() || 'alsa',
    connectDevice: env.SPOTIFY_CONNECT_DEVICE?.trim() || 'default',
    connectBitrate: Math.max(96, Math.min(320, num(env.SPOTIFY_CONNECT_BITRATE, 320))),
    connectFormat: env.SPOTIFY_CONNECT_FORMAT?.trim() || '',
    connectNormalize: env.SPOTIFY_CONNECT_NORMALIZE === '1',
  },
  tidal: {
    clientId: env.TIDAL_CLIENT_ID ?? '',
    redirectUri: env.TIDAL_REDIRECT_URI ?? '',
    /** Space- or comma-separated; empty = the service's default permissions. */
    scopes: env.TIDAL_SCOPES ?? '',
  },
  youtube: {
    /** Optional fallback. The UI can save a YouTube Data API v3 key without editing .env. */
    apiKey: env.YOUTUBE_API_KEY ?? '',
  },
  androidAutoDev: {
    /** Android Auto developer Head Unit Server over ADB. Phone-hotspot/Wi-Fi ADB is primary; USB is fallback. */
    enabled: process.platform === 'linux' && env.ANDROID_AUTO_DEV_ENABLED === '1',
    adbCommand: env.ANDROID_AUTO_ADB?.trim() || 'adb',
    /** Automatically reconnect ADB + tcp:5277 when the paired phone hotspot is reachable. */
    // Reconnect ADB itself automatically, but do not auto-open/bridge Android Auto.
    // Use a new opt-in key so stale ANDROID_AUTO_DEV_AUTO_CONNECT=1 cannot revive the old boot behavior.
    autoConnect: env.ANDROID_AUTO_DEV_AUTO_BRIDGE === '1',
    /** Persist the last successful wireless-debugging endpoint across car restarts. */
    stateFile: resolve(dataDir, 'android-auto-adb.json'),
    /** Android Auto's developer Head Unit Server / DHU tunnel port. */
    phonePort: num(env.ANDROID_AUTO_DEV_PHONE_PORT, 5277),
    /** OpenAuto Prodigy's local AA TCP listener. */
    receiverPort: num(env.ANDROID_AUTO_DEV_RECEIVER_PORT, 5288),
  },
  projection: {
    /** Native Android Auto receiver command. The installer configures OpenAuto Prodigy here. */
    command: projectionCommand,
    args: splitCommand(env.PROJECTION_ARGS ?? ''),
    /** Default to on-demand so the dashboard always owns the display at boot. */
    mode: projectionMode as 'ondemand' | 'resident',
    /** Wayland focus hooks used to switch between the native receiver and the dashboard. */
    focusCommand: env.PROJECTION_FOCUS_COMMAND ?? '',
    backCommand: env.PROJECTION_BACK_COMMAND ?? '',
  },
  /**
   * FM transmitter (docs/fm.md). Environment only, never settings.json: the helper's password must not end up in a backup, a screen or a log.
   * The password prints as stars if this object is ever logged.
   */
  fm: readFmConfig(env),
};

export type Config = typeof config;
