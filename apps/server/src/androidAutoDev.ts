import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { AndroidAutoDevState } from '@headunit/shared';
import type { Config } from './config';
import { Observable } from './observable';
import type { ProjectionProvider } from './providers/projection';

const execFileAsync = promisify(execFile);

export interface AndroidAutoDevProvider {
  readonly state: Observable<AndroidAutoDevState>;
  start(): void;
  command(command: 'refresh' | 'connect' | 'disconnect'): Promise<void>;
  pairWifi(endpoint: string, code: string): Promise<void>;
  connectWifi(endpoint?: string): Promise<void>;
  dispose(): void;
}

interface AdbPhone {
  serial: string;
  state: 'device' | 'unauthorized' | 'offline' | string;
  model?: string;
}

interface SavedWifiPeer {
  endpoint?: string;
  host?: string;
  updatedAt?: string;
}

function parseAdbDevices(text: string): AdbPhone[] {
  const out: AdbPhone[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices attached') || line.startsWith('* daemon')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0]!;
    const state = parts[1]!;
    const modelToken = parts.find((p) => p.startsWith('model:'));
    const model = modelToken?.slice('model:'.length).replaceAll('_', ' ');
    out.push({ serial, state, ...(model ? { model } : {}) });
  }
  return out;
}

function isWifiSerial(serial: string): boolean {
  return /:\d{2,5}$/.test(serial) && !serial.startsWith('emulator-');
}

function parseEndpoint(raw: string): { endpoint: string; host: string; port: number } | null {
  const value = raw.trim();
  if (!value || value.length > 160) return null;
  const m = value.match(/^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = m[1]!;
  return { endpoint: `${host}:${port}`, host, port };
}

function parseMdnsConnectEndpoints(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.includes('_adb-tls-connect._tcp')) continue;
    const matches = raw.match(/(?:\[[0-9a-fA-F:]+\]|(?:\d{1,3}\.){3}\d{1,3}|[A-Za-z0-9.-]+):\d{2,5}/g) ?? [];
    for (const candidate of matches) {
      const parsed = parseEndpoint(candidate);
      if (parsed && !found.includes(parsed.endpoint)) found.push(parsed.endpoint);
    }
  }
  return found;
}

function connectTcp(port: number, timeoutMs = 5000, host = '127.0.0.1'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('error', onError);
      if (err) {
        socket.destroy();
        reject(err);
      } else {
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 5000);
        resolve(socket);
      }
    };
    const onError = (e: Error) => finish(e);
    const timer = setTimeout(() => finish(new Error(`Timed out connecting to ${host}:${port}`)), timeoutMs);
    socket.once('connect', () => finish());
    socket.once('error', onError);
  });
}

/**
 * Android Auto Developer Head Unit Server bridge.
 *
 * The phone exposes Android Auto on tcp:5277 through ADB. ADB may reach the phone over the
 * phone's hotspot/Wireless debugging (preferred) or USB (fallback). We forward tcp:5277 through
 * whichever ADB transport is active and relay it byte-for-byte to the native OpenAuto receiver.
 * The Pi never has to create a Wi-Fi AP for this developer transport.
 */
export function createAndroidAutoDev(cfg: Config['androidAutoDev'], projection: ProjectionProvider): AndroidAutoDevProvider {
  const state = new Observable<AndroidAutoDevState>({
    enabled: cfg.enabled,
    adbInstalled: false,
    phoneState: cfg.enabled ? 'disconnected' : 'missing-adb',
    wifiDiscovered: false,
    forwardReady: false,
    receiverPort: cfg.receiverPort,
    bridgeState: 'idle',
    detail: cfg.enabled ? undefined : 'Android Auto developer transport is only available on the Raspberry Pi/Linux build.',
  });

  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  let refreshing = false;
  let phoneSocket: Socket | null = null;
  let receiverSocket: Socket | null = null;
  let selectedSerial: string | undefined;
  let closeGeneration = 0;
  let saved: SavedWifiPeer = {};
  let nextWifiConnectAt = 0;
  let nextBridgeAttemptAt = 0;

  const set = (patch: Partial<AndroidAutoDevState>) => {
    const next = { ...state.get(), ...patch };
    if (JSON.stringify(next) !== JSON.stringify(state.get())) state.set(next);
  };

  async function adb(args: string[], timeout = 7000): Promise<string> {
    const { stdout } = await execFileAsync(cfg.adbCommand, args, {
      timeout,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' },
    });
    return stdout.trim();
  }

  async function loadSaved(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(cfg.stateFile, 'utf8')) as SavedWifiPeer;
      const parsed = raw.endpoint ? parseEndpoint(raw.endpoint) : null;
      saved = {
        ...(parsed ? { endpoint: parsed.endpoint, host: parsed.host } : {}),
        ...(typeof raw.host === 'string' && raw.host.length < 128 ? { host: raw.host } : {}),
        ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
      };
    } catch {
      saved = {};
    }
  }

  async function savePeer(endpoint?: string): Promise<void> {
    const parsed = endpoint ? parseEndpoint(endpoint) : null;
    if (parsed) saved = { endpoint: parsed.endpoint, host: parsed.host, updatedAt: new Date().toISOString() };
    else if (saved.host) saved = { ...saved, updatedAt: new Date().toISOString() };
    else return;
    try {
      await mkdir(dirname(cfg.stateFile), { recursive: true });
      await writeFile(cfg.stateFile, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
    } catch (e) {
      console.warn('[android-auto-dev] could not persist wireless ADB peer', e);
    }
  }

  async function hotspotGateway(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('ip', ['-4', 'route', 'show', 'default'], { timeout: 2500, maxBuffer: 64 * 1024 });
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/\bvia\s+((?:\d{1,3}\.){3}\d{1,3})\b/);
        if (m) return m[1];
      }
    } catch { /* no default route yet */ }
    return undefined;
  }

  async function mdnsEndpoints(): Promise<string[]> {
    try {
      return parseMdnsConnectEndpoints(await adb(['mdns', 'services'], 3500));
    } catch {
      return [];
    }
  }

  async function devices(): Promise<AdbPhone[]> {
    return parseAdbDevices(await adb(['devices', '-l']));
  }

  async function tryAdbConnect(endpoint: string): Promise<boolean> {
    const parsed = parseEndpoint(endpoint);
    if (!parsed) return false;
    try {
      const out = await adb(['connect', parsed.endpoint], 6000);
      const ok = /connected to|already connected to/i.test(out);
      if (ok) await savePeer(parsed.endpoint);
      return ok;
    } catch {
      return false;
    }
  }

  async function maybeAutoConnectWifi(gateway?: string): Promise<{ endpoints: string[]; attempted: boolean }> {
    const endpoints = await mdnsEndpoints();
    if (Date.now() < nextWifiConnectAt) return { endpoints, attempted: false };
    nextWifiConnectAt = Date.now() + 10_000;

    const candidates: string[] = [];
    for (const e of endpoints) if (!candidates.includes(e)) candidates.push(e);
    if (saved.endpoint && !candidates.includes(saved.endpoint)) candidates.push(saved.endpoint);
    if (gateway && saved.endpoint) {
      const parsed = parseEndpoint(saved.endpoint);
      if (parsed) {
        const viaGateway = `${gateway}:${parsed.port}`;
        if (!candidates.includes(viaGateway)) candidates.push(viaGateway);
      }
    }
    for (const endpoint of candidates) {
      if (await tryAdbConnect(endpoint)) break;
    }
    return { endpoints, attempted: candidates.length > 0 };
  }

  async function refreshNow(): Promise<void> {
    if (disposed || refreshing || !cfg.enabled) return;
    refreshing = true;
    let autoBridge = false;
    try {
      try {
        await adb(['version'], 3000);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT' || /not found/i.test(err.message)) {
          set({
            adbInstalled: false,
            phoneState: 'missing-adb',
            phoneSerial: undefined,
            phoneModel: undefined,
            transport: undefined,
            wifiDiscovered: false,
            forwardReady: false,
            detail: 'ADB is not installed. Run the normal RPI Head Unit installer once.',
          });
          return;
        }
        set({ adbInstalled: false, phoneState: 'offline', forwardReady: false, detail: `ADB error: ${err.message}` });
        return;
      }

      const gateway = await hotspotGateway();
      let list = await devices();
      let mdns = await mdnsEndpoints();
      let readyWifi = list.find((d) => d.state === 'device' && isWifiSerial(d.serial));

      if (!readyWifi) {
        const auto = await maybeAutoConnectWifi(gateway);
        if (auto.endpoints.length) mdns = auto.endpoints;
        if (auto.attempted) {
          await new Promise((r) => setTimeout(r, 250));
          list = await devices();
          readyWifi = list.find((d) => d.state === 'device' && isWifiSerial(d.serial));
        }
      }

      const readyUsb = list.find((d) => d.state === 'device' && !isWifiSerial(d.serial));
      const unauthorized = list.find((d) => d.state === 'unauthorized');
      const offline = list.find((d) => d.state === 'offline');
      const phone = readyWifi ?? readyUsb ?? unauthorized ?? offline;

      if (!phone) {
        selectedSerial = undefined;
        const wasActive = state.get().bridgeState === 'active';
        set({
          adbInstalled: true,
          phoneState: 'disconnected',
          phoneSerial: undefined,
          phoneModel: undefined,
          transport: undefined,
          wifiEndpoint: saved.endpoint,
          hotspotGateway: gateway,
          wifiDiscovered: mdns.length > 0,
          forwardReady: false,
          detail: saved.endpoint || mdns.length
            ? 'Phone hotspot is up, but Wireless debugging is not connected yet. The Pi will keep retrying automatically.'
            : 'Pair Wireless debugging once below. USB ADB remains available as a fallback.',
        });
        if (wasActive) await disconnectBridge(false, 'ADB connection to the phone was lost.');
        return;
      }

      selectedSerial = phone.serial;
      const transport = isWifiSerial(phone.serial) ? 'wifi' : 'usb';
      if (transport === 'wifi') await savePeer(phone.serial);
      const phoneState = phone.state === 'device' ? 'ready' : phone.state === 'unauthorized' ? 'unauthorized' : 'offline';
      let forwardReady = false;
      if (phoneState === 'ready') {
        try {
          const forwards = await adb(['forward', '--list']);
          forwardReady = forwards.split(/\r?\n/).some((line) => {
            const [serial, local, remote] = line.trim().split(/\s+/);
            return serial === phone.serial && local === `tcp:${cfg.phonePort}` && remote === `tcp:${cfg.phonePort}`;
          });
        } catch {
          forwardReady = false;
        }
      }

      let detail: string | undefined;
      if (phoneState === 'unauthorized') detail = transport === 'usb'
        ? 'Unlock the phone and tap Allow on the USB debugging prompt.'
        : 'Wireless debugging authorization is pending on the phone.';
      else if (phoneState === 'offline') detail = 'ADB sees the phone, but it is offline. Toggle Wireless debugging or reconnect USB.';
      else if (state.get().bridgeState === 'idle') detail = transport === 'wifi'
        ? 'Phone hotspot + ADB Wi-Fi ready. Start Android Auto → Developer settings → Head unit server, then tap Connect Android Auto now.'
        : 'USB ADB fallback ready. Start Android Auto → Developer settings → Head unit server.';
      else detail = state.get().detail;

      set({
        adbInstalled: true,
        phoneState,
        phoneSerial: phone.serial,
        phoneModel: phone.model,
        transport,
        wifiEndpoint: transport === 'wifi' ? phone.serial : (mdns[0] ?? saved.endpoint),
        hotspotGateway: gateway,
        wifiDiscovered: mdns.length > 0 || transport === 'wifi',
        forwardReady,
        detail,
      });

      autoBridge = cfg.autoConnect && phoneState === 'ready' && state.get().bridgeState !== 'active' && Date.now() >= nextBridgeAttemptAt;
    } finally {
      refreshing = false;
    }

    if (autoBridge && !disposed) {
      nextBridgeAttemptAt = Date.now() + 8_000;
      void connectBridge(true, false);
    }
  }

  function closeSockets(): void {
    closeGeneration += 1;
    const a = phoneSocket;
    const b = receiverSocket;
    phoneSocket = null;
    receiverSocket = null;
    a?.unpipe();
    b?.unpipe();
    a?.destroy();
    b?.destroy();
  }

  async function removeForward(): Promise<void> {
    const serial = selectedSerial ?? state.get().phoneSerial;
    if (!serial || !state.get().adbInstalled) return;
    await adb(['-s', serial, 'forward', '--remove', `tcp:${cfg.phonePort}`], 4000).catch(() => undefined);
  }

  async function disconnectBridge(showDashboard = true, reason?: string): Promise<void> {
    closeSockets();
    await removeForward();
    set({
      forwardReady: false,
      bridgeState: reason ? 'error' : 'idle',
      detail: reason ?? (state.get().phoneState === 'ready'
        ? `${state.get().transport === 'wifi' ? 'ADB Wi-Fi' : 'USB ADB'} ready. Start the phone Head Unit Server; auto-connect will retry.`
        : state.get().detail),
    });
    if (showDashboard) await projection.stop().catch(() => undefined);
  }

  async function connectBridge(skipRefresh = false, showProjection = true): Promise<void> {
    if (!cfg.enabled) return;
    if (state.get().bridgeState === 'active' && phoneSocket && receiverSocket) {
      if (showProjection) await projection.launch();
      return;
    }

    if (!skipRefresh) await refreshNow();
    const s = state.get();
    if (!s.adbInstalled) return set({ bridgeState: 'error', detail: s.detail || 'ADB is not installed.' });
    if (s.phoneState !== 'ready' || !s.phoneSerial) {
      return set({ bridgeState: 'error', detail: 'Connect Wireless debugging to the phone hotspot first (USB ADB also works as fallback).' });
    }

    closeSockets();
    set({ bridgeState: 'connecting', detail: `Creating ADB ${s.transport === 'wifi' ? 'Wi-Fi' : 'USB'} tunnel to the phone Head Unit Server…` });

    try {
      await adb(['-s', s.phoneSerial, 'forward', '--remove', `tcp:${cfg.phonePort}`], 4000).catch(() => undefined);
      await adb(['-s', s.phoneSerial, 'forward', `tcp:${cfg.phonePort}`, `tcp:${cfg.phonePort}`], 5000);
      set({ forwardReady: true, detail: 'ADB tunnel ready. Connecting Android Auto to the native receiver…' });

      const phone = await connectTcp(cfg.phonePort, 4500).catch((e) => {
        throw new Error(`ADB is ready, but the phone Head Unit Server is not answering on ${cfg.phonePort}. On the phone open Android Auto → Developer settings → Start head unit server. (${(e as Error).message})`);
      });

      // Keep OpenAuto completely stopped while the dashboard is in use. Once the
      // phone Head Unit Server has actually answered, start the native receiver
      // on demand and wait for its projection listener before bridging traffic.
      if (projection.state.get().mode === 'ondemand') {
        await projection.launch();
      }

      let receiver: Socket | null = null;
      let receiverError: Error | null = null;
      const receiverDeadline = Date.now() + 12_000;
      while (!receiver && Date.now() < receiverDeadline) {
        for (const host of ['127.0.0.1', '10.0.0.1']) {
          try {
            receiver = await connectTcp(cfg.receiverPort, 1200, host);
            break;
          } catch (e) {
            receiverError = e as Error;
          }
        }
        if (!receiver) await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (!receiver) {
        phone.destroy();
        if (projection.state.get().mode === 'ondemand') await projection.stop().catch(() => undefined);
        throw new Error(`OpenAuto receiver did not become ready on port ${cfg.receiverPort}. (${receiverError?.message ?? 'connection refused'})`);
      }

      phoneSocket = phone;
      receiverSocket = receiver;
      const generation = closeGeneration;
      let ended = false;
      const onEnded = (where: string) => {
        if (ended || disposed || generation !== closeGeneration) return;
        ended = true;
        closeSockets();
        set({ bridgeState: 'error', forwardReady: false, detail: `Android Auto session ended (${where}). Auto-connect will retry.` });
        void removeForward();
        void projection.stop().catch(() => undefined);
      };
      phone.on('error', (e) => onEnded(`phone: ${e.message}`));
      receiver.on('error', (e) => onEnded(`receiver: ${e.message}`));
      phone.on('close', () => onEnded('phone connection closed'));
      receiver.on('close', () => onEnded('receiver connection closed'));

      phone.pipe(receiver);
      receiver.pipe(phone);
      set({
        bridgeState: 'active',
        forwardReady: true,
        detail: `Android Auto connected over ${s.transport === 'wifi' ? 'phone hotspot / ADB Wi-Fi' : 'USB ADB fallback'}.`,
      });
      if (showProjection) await projection.launch();
    } catch (e) {
      closeSockets();
      await removeForward();
      set({ bridgeState: 'error', forwardReady: false, detail: e instanceof Error ? e.message : 'Android Auto developer connection failed.' });
    }
  }

  async function pairWifi(endpoint: string, code: string): Promise<void> {
    if (!/^\d{6}$/.test(code.trim())) throw new Error('Pairing code must be the 6-digit code shown by Android Wireless debugging.');
    const parsed = parseEndpoint(endpoint);
    if (!parsed) throw new Error('Enter the pairing address exactly as shown on the phone, for example 192.168.43.1:37123.');
    set({ bridgeState: 'connecting', detail: `Pairing ADB Wi-Fi with ${parsed.endpoint}…` });
    try {
      const out = await adb(['pair', parsed.endpoint, code.trim()], 12_000);
      if (!/successfully paired|paired to/i.test(out)) throw new Error(out || 'ADB did not confirm pairing.');
      saved = { ...saved, host: parsed.host, updatedAt: new Date().toISOString() };
      await savePeer();
      nextWifiConnectAt = 0;
      set({ bridgeState: 'idle', detail: 'Wireless debugging paired. Looking for the phone’s ADB connect service…' });
      await new Promise((r) => setTimeout(r, 700));
      await refreshNow();
    } catch (e) {
      set({ bridgeState: 'error', detail: e instanceof Error ? e.message : 'Wireless debugging pairing failed.' });
      throw e;
    }
  }

  async function connectWifi(endpoint?: string): Promise<void> {
    let target = endpoint?.trim() || '';
    if (target) {
      const parsed = parseEndpoint(target);
      if (!parsed) throw new Error('Enter the Wireless debugging address as IP:port.');
      target = parsed.endpoint;
      await savePeer(target);
    } else {
      const mdns = await mdnsEndpoints();
      target = mdns[0] ?? saved.endpoint ?? '';
    }
    if (!target) throw new Error('No wireless-debugging endpoint found. Pair once, or enter the IP:port shown on the phone.');
    set({ bridgeState: 'connecting', detail: `Connecting ADB over the phone hotspot to ${target}…` });
    if (!(await tryAdbConnect(target))) {
      set({ bridgeState: 'error', detail: `Could not connect ADB to ${target}. Keep Wireless debugging ON and confirm the Pi is connected to the phone hotspot.` });
      return;
    }
    set({ bridgeState: 'idle', detail: 'ADB Wi-Fi connected. Waiting for Android Auto Head Unit Server…' });
    nextWifiConnectAt = Date.now() + 10_000;
    await refreshNow();
  }

  return {
    state,
    start() {
      if (!cfg.enabled || disposed) return;
      void loadSaved().then(() => refreshNow());
      timer = setInterval(() => void refreshNow(), 3000);
      timer.unref();
    },
    async command(command) {
      if (command === 'refresh') return refreshNow();
      if (command === 'connect') return connectBridge();
      return disconnectBridge(true);
    },
    pairWifi,
    connectWifi,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      closeSockets();
      void removeForward();
    },
  };
}
