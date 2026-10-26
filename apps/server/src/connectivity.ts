import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface WifiNetwork {
  ssid: string;
  bssid: string;
  signal: number;
  security: string;
  frequency: number;
  active: boolean;
  saved: boolean;
  savedUuid?: string | null;
}

export interface WifiSavedConnection {
  name: string;
  uuid: string;
  ssid: string;
  autoconnect: boolean;
  active: boolean;
}

export interface WifiConnectivityState {
  available: boolean;
  powered: boolean;
  device?: string;
  state?: string;
  connection?: string;
  ip4?: string;
  gateway?: string;
  networks: WifiNetwork[];
  saved: WifiSavedConnection[];
  error?: string;
}

export interface BluetoothConnectivityDevice {
  address: string;
  name: string;
  alias: string;
  icon?: string;
  paired: boolean;
  trusted: boolean;
  connected: boolean;
  blocked: boolean;
  rssi?: number;
}

export interface BluetoothConnectivityState {
  available: boolean;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  controller?: string;
  devices: BluetoothConnectivityDevice[];
  error?: string;
}

export interface ConnectivityState {
  ok: boolean;
  wifi: WifiConnectivityState;
  bluetooth: BluetoothConnectivityState;
}

export const CONNECTIVITY_ACTIONS = new Set([
  'wifi-power',
  'wifi-scan',
  'wifi-connect',
  'wifi-disconnect',
  'wifi-forget',
  'wifi-edit',
  'bt-power',
  'bt-scan',
  'bt-discoverable',
  'bt-pair',
  'bt-connect',
  'bt-disconnect',
  'bt-forget',
  'bt-trust',
  'bt-rename',
] as const);

export type ConnectivityAction = typeof CONNECTIVITY_ACTIONS extends Set<infer T> ? T : never;

function helperPath() {
  return process.env.HEADUNIT_CONNECTIVITY_HELPER || '/usr/local/sbin/headunit-connectivity';
}

/**
 * Run the root-owned connectivity helper. The helper accepts JSON only on stdin and validates every
 * address/UUID before it invokes NetworkManager or BlueZ, so the web service never gets arbitrary sudo.
 */
export function runConnectivityHelper(action: 'state' | ConnectivityAction, payload: Record<string, unknown> = {}): Promise<any> {
  if (!existsSync(helperPath())) return Promise.reject(new Error('Run sudo ./install.sh once to enable Wi-Fi/Bluetooth controls.'));
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', helperPath(), action], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const max = 2 * 1024 * 1024;
    const timer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGKILL');
      reject(new Error('Connectivity operation timed out'));
    }, action === 'bt-pair' ? 50_000 : action === 'wifi-connect' ? 50_000 : action === 'bt-scan' ? 15_000 : 30_000);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > max) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > max) child.kill('SIGKILL');
    });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Connectivity helper could not start: ${err.message}`));
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      let body: any;
      try {
        body = JSON.parse(stdout.trim() || stderr.trim() || '{}');
      } catch {
        body = undefined;
      }
      if (code !== 0 || body?.ok === false) {
        const msg = body?.error || stderr.trim().split('\n').filter(Boolean).at(-1) || stdout.trim().split('\n').filter(Boolean).at(-1) || `Connectivity helper failed (${code ?? 'unknown'})`;
        reject(new Error(String(msg)));
        return;
      }
      resolve(body);
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
