import { setDefaultResultOrder } from 'node:dns';
import { config } from './config';
import { Observable } from './observable';
import { JsonStore } from './store';
import { createMusic } from './connections/music';
import { startSpotifyCallbackBridge } from './spotifyCallbackBridge';
import { importBundledMusicCredentials } from './connections/provision';
import { migrateSpotifyCallback8787 } from './connections/spotifyRedirectMigration';
import { createCamera } from './providers/camera';
import { createBluezDevices } from './providers/devicesBluez';
import { createProjection, yieldAudioToProjection } from './providers/projection';
import { createRadio } from './radio/radio';
import { createObdVehicle } from './providers/vehicleObd';
import type { VehicleProvider } from './providers/vehicle';
import { createTransport } from './obd/transport';
import { createApp, loadPersisted } from './server';
import { createSystem } from './system/system';
import { createSpotifyConnectReceiver } from './spotifyConnect';
import { createAndroidAutoDev } from './androidAutoDev';
import { createHardwareInput } from './hardwareInput';
import { GpsCenter } from './gpsCenter';
import { WledCenter } from './wledCenter';
import { DashcamCenter } from './dashcamCenter';
import { createDemoFetch, createDemoWorld, isDemoMode, runGpsSim, seedDemoData } from './demo';

// Pi hotspots sometimes advertise unreachable IPv6 addresses. Node/Undici can
// fail the Spotify token POST even when Chromium loads the Spotify login page.
// Try IPv4 first while retaining IPv6 as fallback; allow opt-out if necessary.
if (process.platform === 'linux' && process.env.HEADUNIT_DNS_RESULT_ORDER !== 'system') {
  setDefaultResultOrder('ipv4first');
}

// Simulated hardware, only when started with --demo (npm run dev). A real head unit never runs this path.
const demo = isDemoMode() ? createDemoWorld() : null;
const store = new JsonStore(config.dataDir);
if (demo) await seedDemoData(store);
else {
  await importBundledMusicCredentials(store, config.projectDir, config.dataDir);
  await migrateSpotifyCallback8787(store, config.spotify.redirectUri);
}
const persisted = await loadPersisted(store);
// Older builds could persist `musicSource: demo`; sanitizeSettings now maps that legacy value back to Auto.

// Real vehicle provider only. If the adapter/ECU is absent, the OBD provider reports the link as unavailable instead of inventing values.
const vehicle: VehicleProvider = demo?.vehicle ?? createObdVehicle({ createTransport: () => createTransport(config.obd.port, config.obd.baud) });
// One settings object, shared with the HTTP/WebSocket layer, so changing "Music source" in Settings switches the player live.
const settings = new Observable(persisted.settings);
const gps = new GpsCenter(store);
const wled = new WledCenter(store);
const dashcam = new DashcamCenter(store, config.dataDir);
await Promise.all([gps.start(!demo), wled.start(), dashcam.start()]);
const stopGpsSim = demo ? runGpsSim(vehicle.state, (msg) => gps.ingest(msg)) : () => {};
const music = createMusic({ store, settings, config, ...(demo ? { mock: demo.mock, allowDemo: true } : {}) });
await music.ready;
const spotifyConnect = createSpotifyConnectReceiver({
  enabled: config.spotify.connectEnabled && !demo,
  name: config.spotify.deviceName,
  binary: config.spotify.connectBinary,
  backend: config.spotify.connectBackend,
  device: config.spotify.connectDevice,
  bitrate: config.spotify.connectBitrate,
  format: config.spotify.connectFormat,
  normalize: config.spotify.connectNormalize,
  dataDir: config.dataDir,
});
/** Spotify or TIDAL — whichever real service is active. */
const media = music.media;
const system = demo?.system ?? createSystem();
const projection = demo?.projection ?? createProjection(config.projection);
const androidAutoDev = createAndroidAutoDev(config.androidAutoDev, projection);
const camera = createCamera();
const devices = demo?.devices ?? createBluezDevices();
const hardware = createHardwareInput();
const radio = createRadio({
  store,
  // Starting radio pauses the music service — but only if it's actually playing, so we don't wake its device for nothing.
  onStart: () => {
    if (media.state.get().playing) void media.command({ cmd: 'pause' });
  },
});
await radio.load();
// …and starting music afterwards stops the radio.
media.state.subscribe((m) => radio.notifyMediaPlaying(m.playing));
// …and showing Android Auto silences both (radio stops, music pauses; nothing resumes by itself). The browser's own
// players (TIDAL / YouTube embeds) are the UI's job: it pauses them while projection.status === 'active'.
yieldAudioToProjection(projection.state, { media, radio });

const app = createApp({
  config,
  store,
  gps,
  wled,
  dashcam,
  vehicle,
  media,
  connections: music.connections,
  system,
  projection,
  androidAutoDev,
  devices,
  radio,
  camera,
  settings,
  spotifyConnect,
  hardware,
  layout: new Observable(persisted.layout),
  demo: Boolean(demo),
  // Weather, place search, lyrics and web-hooks answer from the simulation: the demo needs no internet and sends nothing out.
  ...(demo ? { fetch: createDemoFetch() } : {}),
});

await app.features.start();
await system.start();
spotifyConnect.start();
vehicle.start();
media.start();
projection.start();
androidAutoDev.start();
devices.start();
hardware.start();

// Production and the Spotify callback now both use port 8787. Retain the optional
// 5173 loopback bridge only for users who manually select that legacy redirect.
// The one-time migration above moves existing v2.8.2–v2.8.6 installations to 8787.
let spotifyCallbackBridge: ReturnType<typeof startSpotifyCallbackBridge> = null;
app.server.listen(config.port, config.host, () => {
  const runningBuiltApp = process.env.NODE_ENV === 'production' ||
    /(?:^|[\\/])dist[\\/]index\.js$/.test(process.argv[1] ?? '');
  if (!demo && runningBuiltApp) {
    spotifyCallbackBridge = startSpotifyCallbackBridge(music.connections.get('spotify').redirectUri, config.port);
  }
  console.log(`[headunit] listening on http://${config.host}:${config.port}`);
  console.log(demo ? '[headunit] mode: DEMO (simulated car, phones, music and GPS; nothing here is real)' : '[headunit] mode: hardware/services only');
  console.log(demo ? '[headunit] vehicle: simulated drive cycle' : config.obd.port ? `[headunit] vehicle: OBD-II on ${config.obd.port}` : '[headunit] vehicle: no OBD-II adapter set up (OBD_PORT)');
  console.log(`[headunit] music: ${music.describe()}`);
  console.log(`[headunit] Spotify output: ${config.spotify.connectEnabled && !demo ? `${config.spotify.deviceName} native Connect @ ${config.spotify.connectBitrate} kbps` : 'native disabled; browser fallback available'}`);
  // Where each Client ID came from ('missing' = none yet; add one in Settings > Music services or with `npm run setup`).
  const ids = music.connections.list().map((c) => `${c.service} ${c.clientIdSource === 'none' ? 'missing' : c.clientIdSource}`);
  console.log(`[headunit] music Client IDs: ${ids.join(', ')}`);
  // Each must be registered exactly in that service's developer dashboard.
  console.log(`[headunit] music sign-in callbacks: ${music.connections.list().map((c) => `${c.service} ${c.redirectUri}`).join(', ')}`);
  console.log(
    `[headunit] projection: ${config.projection.command ? `${config.projection.command} (${config.projection.mode})` : 'unavailable (native receiver not configured)'}`,
  );
  console.log(`[headunit] Android Auto developer transport: ${config.androidAutoDev.enabled ? `ADB Wi-Fi primary / USB fallback, tcp:${config.androidAutoDev.phonePort} -> receiver tcp:${config.androidAutoDev.receiverPort}` : 'disabled'}`);
});

const shutdown = () => {
  stopGpsSim();
  vehicle.stop();
  gps.stop();
  wled.stop();
  dashcam.stop();
  spotifyConnect.stop();
  music.dispose();
  androidAutoDev.dispose();
  projection.dispose();
  devices.stop();
  hardware.stop();
  // The FM helper is told to stop sending as the server closes. That is one short request; give it time to finish while a carrier is on
  // the air (the helper would stop by itself after its dead-man timeout anyway, but there is no reason to leave it on for 30 seconds).
  const onAir = app.features.services.fm.get().status === 'transmitting';
  spotifyCallbackBridge?.close();
  app.close();
  setTimeout(() => process.exit(0), onAir ? 1500 : 200).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
