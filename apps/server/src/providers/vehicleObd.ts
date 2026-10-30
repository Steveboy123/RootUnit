import type { Dtc, DiagnosticsState, VehicleKey, VehicleLink, VehicleState } from '@headunit/shared';
import { Elm327, ElmError } from '../obd/elm';
import { DTC_DESCRIPTIONS, PIDS, decodeDtcs, decodeMil, supportedFromMask, type PidDef } from '../obd/pids';
import type { Transport } from '../obd/transport';
import { Observable } from '../observable';
import type { VehicleProvider } from './vehicle';

export interface ObdOptions {
  createTransport: () => Transport;
  /** Wait between reconnect attempts after the adapter link fails. */
  retryDelaysMs?: number[];
  /** How often to ask a silent car (ignition off) whether it's awake yet. */
  ecuRetryMs?: number;
  cmdTimeoutMs?: number;
  now?: () => number;
}

const FAST: VehicleKey[] = ['rpm', 'speedKmh'];
const MEDIUM: VehicleKey[] = ['throttlePct', 'loadPct'];
const MISS_LIMIT = 5; // consecutive "NO DATA"s before we decide the car doesn't provide a reading

class EcuLost extends Error {}

const BASE: VehicleState = {
  source: 'obd',
  connected: false,
  link: { status: 'connecting', detail: 'Starting…' },
  speedKmh: 0,
  rpm: 0,
  coolantC: 0,
  intakeC: 0,
  ambientC: 0,
  throttlePct: 0,
  loadPct: 0,
  fuelPct: 0,
  batteryV: 0,
  trip: { distanceKm: 0, durationS: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 },
};

/**
 * Real car data from an ELM327 adapter (Bluetooth serial, USB, or Wi-Fi).
 *
 * Readings the car doesn't provide are listed in `unsupported` and never faked. When the adapter is
 * reachable but the car is silent (ignition off) the link says so, and the provider keeps asking until
 * the car wakes. If the adapter link itself drops, it reconnects with backoff.
 */
export function createObdVehicle(opts: ObdOptions): VehicleProvider {
  const now = opts.now ?? Date.now;
  const retryDelays = opts.retryDelaysMs ?? [2000, 4000, 8000, 15_000, 30_000];
  const ecuRetryMs = opts.ecuRetryMs ?? 3000;

  const state = new Observable<VehicleState>({ ...BASE });
  const diagnostics = new Observable<DiagnosticsState>({ status: 'idle', codes: [], readAt: null });

  let stopped = true;
  let current: { elm: Elm327; can: boolean } | null = null;
  const values: Partial<Record<VehicleKey, number>> = {};
  let unsupported = new Set<VehicleKey>();
  let mil: { on: boolean; count: number } | undefined;
  let link: VehicleLink = { status: 'connecting' };
  let connected = false;
  // Exact accumulators: rounding on every update would swallow small steps and freeze the trip.
  let tripDistKm = 0;
  let tripSecs = 0;
  let tripMaxKmh = 0;
  let lastSpeedTs = 0;
  let pubTimer: NodeJS.Timeout | null = null;
  let lastPub = 0;
  let wake: (() => void) | null = null;

  /** Coalesce bursts of decoded PIDs into at most ~12 UI updates per second. */
  function publish(force = false) {
    const emit = () => {
      pubTimer = null;
      lastPub = now();
      state.set({
        ...BASE,
        ...values,
        connected,
        link,
        mil,
        unsupported: [...unsupported],
        trip: {
          distanceKm: Math.round(tripDistKm * 1000) / 1000,
          durationS: Math.round(tripSecs),
          avgSpeedKmh: tripSecs > 0 ? Math.round((tripDistKm / tripSecs) * 3600 * 10) / 10 : 0,
          maxSpeedKmh: tripMaxKmh,
        },
      } as VehicleState);
    };
    if (force) {
      if (pubTimer) clearTimeout(pubTimer);
      return emit();
    }
    if (pubTimer) return;
    pubTimer = setTimeout(emit, Math.max(0, 80 - (now() - lastPub)));
    pubTimer.unref();
  }

  const setLink = (l: VehicleLink, isConnected = false) => {
    link = l;
    connected = isConnected;
    publish(true);
  };

  /** Interruptible sleep. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      wake = done;
      function done() {
        clearTimeout(t);
        wake = null;
        resolve();
      }
    });

  function recordSpeed(kmh: number) {
    const t = now();
    const dt = lastSpeedTs ? Math.min(2, (t - lastSpeedTs) / 1000) : 0; // cap: a stall mustn't add a huge step
    lastSpeedTs = t;
    tripDistKm += (kmh / 3600) * dt;
    tripSecs += dt;
    tripMaxKmh = Math.max(tripMaxKmh, Math.round(kmh));
  }

  async function discoverSupported(elm: Elm327): Promise<Set<number>> {
    const set = new Set<number>();
    for (const base of [0x00, 0x20, 0x40]) {
      const bytes = await elm.pid(base).catch((e: ElmError) => {
        if (e.kind === 'no-data') return null;
        throw e;
      });
      if (!bytes) break;
      for (const p of supportedFromMask(base, bytes)) set.add(p);
      if (!set.has(base + 0x20)) break; // the car says there's no further page
    }
    return set;
  }

  async function refreshMil(elm: Elm327) {
    const bytes = await elm.pid(0x01).catch((e: ElmError) => {
      if (e.kind === 'no-data') return null;
      throw e;
    });
    if (bytes) mil = decodeMil(bytes);
  }

  async function pollCar(elm: Elm327, supported: Set<number>) {
    const usable = (keys: VehicleKey[]) =>
      keys.map((k) => PIDS.find((p) => p.key === k)!).filter((p) => (supported.size === 0 || supported.has(p.pid)) && !unsupported.has(p.key));
    const slowKeys = PIDS.map((p) => p.key).filter((k) => !FAST.includes(k) && !MEDIUM.includes(k));
    // What the car says it lacks is unsupported from the start (battery voltage has its own fallback below).
    if (supported.size > 0) for (const p of PIDS) if (!supported.has(p.pid) && p.pid !== 0x42) unsupported.add(p.key);
    if (supported.size > 0 && !supported.has(0x42)) unsupported.add('batteryV'); // until the adapter-voltage fallback succeeds
    publish();
    const misses = new Map<number, number>();
    const voltageViaPid = supported.size === 0 || supported.has(0x42);
    let tick = 0;
    let slowIdx = 0;
    let emptyLoops = 0;
    let lastRv = 0;

    const query = async (def: PidDef): Promise<boolean> => {
      try {
        const bytes = await elm.pid(def.pid);
        if (bytes && bytes.length >= def.bytes) {
          const v = def.decode(bytes);
          values[def.key] = v;
          misses.set(def.pid, 0);
          if (def.key === 'speedKmh') recordSpeed(v);
          publish();
          return true;
        }
      } catch (e) {
        if (!(e instanceof ElmError)) throw e;
        if (e.kind === 'unable' || e.kind === 'bus') throw new EcuLost(e.message);
        if (e.kind !== 'no-data') throw e;
      }
      const n = (misses.get(def.pid) ?? 0) + 1;
      misses.set(def.pid, n);
      if (n >= MISS_LIMIT) {
        unsupported.add(def.key);
        publish();
      }
      return false;
    };

    while (!stopped && current?.elm === elm) {
      const slow = usable(slowKeys);
      const batch = [...usable(FAST), ...(tick % 3 === 0 ? usable(MEDIUM) : []), ...(slow.length ? [slow[slowIdx++ % slow.length]!] : [])];
      let answered = 0;
      for (const def of batch) if (await query(def)) answered++;

      if (tick % 25 === 0) await refreshMil(elm);
      // Cars without PID 0x42 (module voltage): the adapter can measure battery voltage itself.
      if (!voltageViaPid && now() - lastRv > 5000) {
        lastRv = now();
        const v = await elm.adapterVoltage().catch(() => null);
        if (v !== null) {
          values.batteryV = v;
          unsupported.delete('batteryV');
        } else unsupported.add('batteryV');
      }

      if (batch.length > 0 && answered === 0) {
        if (++emptyLoops >= 3) throw new EcuLost('The car stopped answering');
      } else emptyLoops = 0;
      tick++;
    }
  }

  async function session() {
    const t = opts.createTransport();
    const elm = new Elm327(t, opts.cmdTimeoutMs ?? 3000);
    try {
      setLink({ status: 'connecting', detail: 'Opening the adapter…' });
      await t.open();
      setLink({ status: 'connecting', detail: 'Setting up the adapter…' });
      const { adapter } = await elm.init();
      current = { elm, can: true };
      attempt = 0; // the adapter itself is healthy

      while (!stopped) {
        setLink({ status: 'connecting', detail: 'Looking for the car…', adapter });
        let proto: { protocol: string; can: boolean };
        try {
          proto = await elm.connectEcu();
        } catch (e) {
          if (e instanceof ElmError && (e.kind === 'unable' || e.kind === 'no-data' || e.kind === 'bus')) {
            setLink({ status: 'ecu-off', adapter, detail: 'Adapter connected — the car isn’t answering (ignition off?)' });
            await sleep(ecuRetryMs);
            continue;
          }
          throw e;
        }
        current = { elm, can: proto.can };
        unsupported = new Set();
        const supported = await discoverSupported(elm);
        await refreshMil(elm);
        lastSpeedTs = 0;
        setLink({ status: 'live', adapter, protocol: proto.protocol }, true);
        try {
          await pollCar(elm, supported);
        } catch (e) {
          if (!(e instanceof EcuLost)) throw e;
          setLink({ status: 'ecu-off', adapter, detail: 'The car stopped answering (ignition off?)' });
          await sleep(ecuRetryMs);
        }
      }
    } finally {
      current = null;
      await elm.close().catch(() => {});
    }
  }

  let attempt = 0;
  async function run() {
    while (!stopped) {
      try {
        await session();
      } catch (e) {
        if (stopped) return;
        const msg = e instanceof Error ? e.message : String(e);
        setLink({ status: 'error', detail: `${msg} — retrying` });
      }
      if (stopped) return;
      await sleep(retryDelays[Math.min(attempt, retryDelays.length - 1)]!);
      attempt++;
    }
  }

  // ---- diagnostics --------------------------------------------------------
  const guard = (): { elm: Elm327; can: boolean } | null => {
    if (!current || !connected) {
      diagnostics.update({ status: 'error', error: 'The car isn’t connected (is the ignition on?)' });
      return null;
    }
    if (diagnostics.get().status === 'reading' || diagnostics.get().status === 'clearing') return null;
    return current;
  };
  const readCodes = async (c: { elm: Elm327; can: boolean }): Promise<Dtc[]> => {
    const ask = async (cmd: string, mode: '43' | '47') => {
      try {
        return decodeDtcs(await c.elm.cmd(cmd, 8000), mode, c.can);
      } catch (e) {
        if (e instanceof ElmError && e.kind === 'no-data') return []; // many ECUs answer NO DATA when there are none
        throw e;
      }
    };
    const stored = await ask('03', '43');
    const pending = (await ask('07', '47')).filter((code) => !stored.includes(code));
    const describe = (code: string, kind: Dtc['kind']): Dtc => ({ code, kind, ...(DTC_DESCRIPTIONS[code] ? { description: DTC_DESCRIPTIONS[code] } : {}) });
    return [...stored.map((x) => describe(x, 'stored')), ...pending.map((x) => describe(x, 'pending'))];
  };

  return {
    state,
    diagnostics,

    start() {
      if (!stopped) return;
      stopped = false;
      attempt = 0;
      void run();
    },

    stop() {
      stopped = true;
      wake?.();
      if (pubTimer) clearTimeout(pubTimer);
      void current?.elm.close();
    },

    async readDtcs() {
      const c = guard();
      if (!c) return;
      diagnostics.update({ status: 'reading', error: undefined });
      try {
        diagnostics.set({ status: 'idle', codes: await readCodes(c), readAt: now() });
        await refreshMil(c.elm).catch(() => {});
        publish(true);
      } catch (e) {
        diagnostics.update({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },

    async clearDtcs() {
      const c = guard();
      if (!c) return;
      diagnostics.update({ status: 'clearing', error: undefined });
      try {
        await c.elm.cmd('04', 8000);
        diagnostics.set({ status: 'idle', codes: await readCodes(c), readAt: now() });
        await refreshMil(c.elm).catch(() => {});
        publish(true);
      } catch (e) {
        diagnostics.update({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
