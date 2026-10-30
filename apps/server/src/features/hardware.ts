import type { DashcamState, LightingState } from '@headunit/shared';
import type { DashcamCenter } from '../dashcamCenter';
import { Observable } from '../observable';
import type { WledCenter, WledSettings } from '../wledCenter';

/** What the lighting page and the Quick Panel show; nothing is polled while no ESP address is set. */
const NO_LIGHTING: LightingState = { configured: false, connected: false, enabled: false, mode: 'manual', brightness: 100, color: '#30a5ff', host: '', detail: 'Enter your ESP32 WLED IP address.', device: null, leds: null, audioCapture: false, effects: [] };

type RawLighting = Awaited<ReturnType<WledCenter['state']>>;

/** Map WLED's answer onto the shared shape. The device's own on/brightness win over what we last asked for. */
export function toLighting(raw: RawLighting, settings: WledSettings): LightingState {
  const r = raw as { connected?: boolean; detail?: string; device?: string; leds?: number | null; deviceState?: { on?: boolean; bri?: number }; effects?: string[]; audioCapture?: boolean };
  const connected = r.connected === true;
  const dev = connected ? r.deviceState : undefined;
  return {
    configured: Boolean(settings.host),
    connected,
    enabled: typeof dev?.on === 'boolean' ? dev.on : settings.enabled,
    mode: settings.mode,
    brightness: typeof dev?.bri === 'number' ? Math.max(1, Math.min(255, Math.round(dev.bri))) : settings.brightness,
    color: settings.color,
    host: settings.host,
    detail: String(r.detail ?? ''),
    device: connected && typeof r.device === 'string' ? r.device : null,
    leds: connected && typeof r.leds === 'number' ? r.leds : null,
    audioCapture: r.audioCapture === true,
    effects: Array.isArray(r.effects) ? r.effects.filter((e): e is string => typeof e === 'string').slice(0, 256) : [],
  };
}

/** Keeps `state` current by asking the ESP now and then, and publishes only when something visible changed. */
export class LightingService {
  readonly state = new Observable<LightingState>({ ...NO_LIGHTING });
  private timer: NodeJS.Timeout | null = null;
  private last = '';

  constructor(
    private wled: WledCenter,
    private intervalMs = 10_000,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    try {
      const next = toLighting(await this.wled.state(), this.wled.config);
      const key = JSON.stringify(next);
      if (key !== this.last) {
        this.last = key;
        this.state.set(next);
      }
    } catch (err) {
      console.error('[lighting] could not read the ESP:', err);
    }
  }

  async update(patch: Parameters<WledCenter['update']>[0]): Promise<void> {
    await this.wled.update(patch);
    await this.refresh();
  }
}

type RawDashcam = Awaited<ReturnType<DashcamCenter['state']>>;

export function toDashcam(raw: RawDashcam): DashcamState {
  return {
    recording: raw.recording,
    camera: raw.settings.camera,
    cameras: raw.cameras,
    cameraPresent: raw.cameras.includes(raw.settings.camera),
    maxGb: raw.settings.maxGb,
    parkingEvents: raw.settings.parkingEvents,
    clips: raw.clips,
    events: raw.events,
    directory: raw.directory,
    detail: raw.detail,
  };
}

const NO_DASHCAM: DashcamState = { recording: false, camera: '/dev/video0', cameras: [], cameraPresent: false, maxGb: 2, parkingEvents: false, clips: [], events: [], directory: '', detail: 'Checking USB cameras…' };

export class DashcamService {
  readonly state = new Observable<DashcamState>({ ...NO_DASHCAM });
  private timer: NodeJS.Timeout | null = null;
  private last = '';

  constructor(
    private cam: DashcamCenter,
    private intervalMs = 4000,
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    try {
      const next = toDashcam(await this.cam.state());
      const key = JSON.stringify(next);
      if (key !== this.last) {
        this.last = key;
        this.state.set(next);
      }
    } catch (err) {
      console.error('[dashcam] could not read the recorder state:', err);
    }
  }

  async action(action: string, body: Record<string, unknown>): Promise<void> {
    await this.cam.action(action, body);
    await this.refresh();
  }
}
