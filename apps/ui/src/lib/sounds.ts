/**
 * Sleep sounds, made on the spot with WebAudio: noise shaped by filters and slow LFOs into rain, waves, wind and the rest. Nothing is
 * downloaded and nothing is stored. Several sounds mix, each with its own level; a sleep timer fades the lot out.
 *
 * The engine lives at module level, so the sounds go on when the person leaves the app. The noise makers are pure (seeded) and tested;
 * the WebAudio graph is only built in a browser, on the first tap (browsers start audio only from a gesture).
 */

export type NoiseColour = 'white' | 'pink' | 'brown';
export type SoundId = 'rain' | 'waves' | 'wind' | 'stream' | 'fire' | 'cabin' | 'pink' | 'brown' | 'white';

export interface SoundDef {
  id: SoundId;
  label: string;
  hint: string;
  /** A hue for its tile. */
  hue: number;
}

export const SOUNDS: SoundDef[] = [
  { id: 'rain', label: 'Rain', hint: 'Steady rain on the roof', hue: 210 },
  { id: 'waves', label: 'Ocean waves', hint: 'Slow swell on a beach', hue: 190 },
  { id: 'wind', label: 'Wind', hint: 'Gusts through the trees', hue: 160 },
  { id: 'stream', label: 'Stream', hint: 'Water over stones', hue: 175 },
  { id: 'fire', label: 'Campfire', hint: 'Crackling logs', hue: 20 },
  { id: 'cabin', label: 'Night drive', hint: 'A car’s low road hum', hue: 260 },
  { id: 'pink', label: 'Pink noise', hint: 'Soft, even hush', hue: 330 },
  { id: 'brown', label: 'Brown noise', hint: 'Deep rumble', hue: 30 },
  { id: 'white', label: 'White noise', hint: 'Fan-like hiss', hue: 0 },
];

export const SLEEP_CHOICES = [15, 30, 45, 60, 90] as const;
/** How long the sleep timer's fade-out lasts at the end. */
export const FADE_S = 45;

/** A small fast seeded random source (mulberry32), so noise is reproducible in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` samples of coloured noise in -1..1. Pink uses Paul Kellet's filter, brown a leaky integrator; both are normalised to the same
 * peak so switching colour does not jump in loudness.
 */
export function noise(colour: NoiseColour, n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    if (colour === 'white') out[i] = w;
    else if (colour === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last;
    }
  }
  return normalise(out, 0.9);
}

/** Crackles: sparse short decaying clicks, for the campfire. */
export function crackles(n: number, rate: number, perSecond: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  const chance = perSecond / rate;
  for (let i = 0; i < n; i++) {
    if (rand() >= chance) continue;
    const amp = 0.3 + rand() * 0.7;
    const len = Math.floor(rate * (0.002 + rand() * 0.01));
    for (let j = 0; j < len && i + j < n; j++) out[i + j]! += amp * (rand() * 2 - 1) * Math.exp((-6 * j) / len);
  }
  return normalise(out, 0.9);
}

/** Scales `a` in place so its loudest sample is `peak`. */
export function normalise(a: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of a) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < a.length; i++) a[i] = (a[i]! / max) * peak;
  return a;
}

/** Joins a loop's end to its start with a short crossfade, so a looping buffer has no click at the seam. */
export function seamless(a: Float32Array, fade: number): Float32Array {
  const f = Math.min(fade, Math.floor(a.length / 4));
  const out = a.slice(0, a.length - f);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = a[i]! * k + a[a.length - f + i]! * (1 - k);
  }
  return out;
}

/** The master level over the sleep timer: full until the last FADE_S seconds, then down to silence. `left` is seconds remaining. */
export function sleepGain(left: number | null): number {
  if (left === null) return 1;
  if (left <= 0) return 0;
  return Math.min(1, left / FADE_S);
}

export interface SoundsState {
  /** Each playing sound and its level 0..1. */
  playing: Partial<Record<SoundId, number>>;
  master: number;
  /** When the sleep timer ends (epoch ms), or null. */
  sleepAt: number | null;
  /** The browser refused audio (no AudioContext). */
  unsupported: boolean;
}

type Listener = () => void;

interface Voice {
  out: GainNode;
  stop(): void;
}

class SoundEngine {
  state: SoundsState = { playing: {}, master: 0.8, sleepAt: null, unsupported: false };
  private listeners = new Set<Listener>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<SoundId, Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private sleepTimer: number | undefined;

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<SoundsState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) {
      this.set({ unsupported: true });
      return null;
    }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.state.master;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private buffer(key: string, make: (rate: number) => Float32Array): AudioBuffer {
    const ctx = this.ctx!;
    const have = this.buffers.get(key);
    if (have) return have;
    const data = seamless(make(ctx.sampleRate), Math.floor(ctx.sampleRate * 0.25));
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(key, b);
    return b;
  }

  private loop(key: string, make: (rate: number) => Float32Array): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.buffer(key, make);
    src.loop = true;
    return src;
  }

  private lfo(rate: number, depth: number, target: AudioParam): OscillatorNode {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(target);
    return osc;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** The graph for one sound, ending in its own gain node. */
  private build(id: SoundId): Voice {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    const rand = seeded(id.length * 7919 + 13);
    const secs = (rate: number, s: number) => Math.floor(rate * s);
    const sources: AudioScheduledSourceNode[] = [];
    const add = <T extends AudioScheduledSourceNode>(n: T) => (sources.push(n), n);
    const swell = ctx.createGain();
    swell.connect(out);

    switch (id) {
      case 'white':
      case 'pink':
      case 'brown': {
        add(this.loop(id, (r) => noise(id, secs(r, 6), rand))).connect(this.filter('lowpass', id === 'white' ? 9000 : 6000)).connect(swell);
        break;
      }
      case 'rain': {
        add(this.loop('pink', (r) => noise('pink', secs(r, 6), rand))).connect(this.filter('highpass', 500)).connect(this.filter('lowpass', 7000)).connect(swell);
        add(this.loop('drops', (r) => crackles(secs(r, 5), r, 40, rand))).connect(this.filter('bandpass', 3200, 1.2)).connect(swell);
        swell.gain.value = 0.85;
        add(this.lfo(0.11, 0.12, swell.gain));
        break;
      }
      case 'waves': {
        const lp = this.filter('lowpass', 900);
        add(this.loop('brown', (r) => noise('brown', secs(r, 6), rand))).connect(lp).connect(swell);
        add(this.loop('pink', (r) => noise('pink', secs(r, 6), rand))).connect(this.filter('bandpass', 1800, 0.6)).connect(swell);
        swell.gain.value = 0.55;
        add(this.lfo(0.075, 0.45, swell.gain));
        add(this.lfo(0.075, 500, lp.frequency));
        break;
      }
      case 'wind': {
        const bp = this.filter('bandpass', 600, 1.4);
        add(this.loop('white', (r) => noise('white', secs(r, 6), rand))).connect(bp).connect(swell);
        swell.gain.value = 0.7;
        add(this.lfo(0.06, 320, bp.frequency));
        add(this.lfo(0.13, 0.3, swell.gain));
        break;
      }
      case 'stream': {
        const bp = this.filter('bandpass', 2400, 0.9);
        add(this.loop('white', (r) => noise('white', secs(r, 6), rand))).connect(bp).connect(swell);
        add(this.loop('drops', (r) => crackles(secs(r, 5), r, 40, rand))).connect(this.filter('bandpass', 1400, 2)).connect(swell);
        swell.gain.value = 0.6;
        add(this.lfo(1.7, 600, bp.frequency));
        break;
      }
      case 'fire': {
        add(this.loop('brown', (r) => noise('brown', secs(r, 6), rand))).connect(this.filter('lowpass', 500)).connect(swell);
        add(this.loop('crackle', (r) => crackles(secs(r, 7), r, 9, rand))).connect(this.filter('highpass', 1200)).connect(swell);
        swell.gain.value = 0.8;
        break;
      }
      case 'cabin': {
        add(this.loop('brown', (r) => noise('brown', secs(r, 6), rand))).connect(this.filter('lowpass', 220)).connect(swell);
        for (const [f, g] of [[48, 0.05], [96, 0.025]] as const) {
          const o = add(ctx.createOscillator());
          o.frequency.value = f;
          const og = ctx.createGain();
          og.gain.value = g;
          o.connect(og).connect(swell);
        }
        add(this.loop('pink', (r) => noise('pink', secs(r, 6), rand))).connect(this.filter('bandpass', 900, 0.5)).connect(this.gain(0.12)).connect(swell);
        swell.gain.value = 0.9;
        add(this.lfo(0.04, 0.08, swell.gain));
        break;
      }
    }
    out.connect(this.master!);
    for (const s of sources) s.start();
    return {
      out,
      stop: () => {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        out.disconnect();
      },
    };
  }

  private gain(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  /** Starts `id` at `level` (0..1), or changes its level when it is already playing. */
  play(id: SoundId, level = 0.7) {
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume();
    let v = this.voices.get(id);
    if (!v) {
      v = this.build(id);
      this.voices.set(id, v);
      v.out.gain.setValueAtTime(0, ctx.currentTime);
    }
    v.out.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
    this.set({ playing: { ...this.state.playing, [id]: level } });
  }

  stop(id: SoundId) {
    const v = this.voices.get(id);
    const ctx = this.ctx;
    if (v && ctx) {
      v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      window.setTimeout(() => v.stop(), 1200);
    }
    this.voices.delete(id);
    const playing = { ...this.state.playing };
    delete playing[id];
    this.set({ playing });
    if (Object.keys(playing).length === 0) this.sleep(null);
  }

  toggle(id: SoundId) {
    if (this.state.playing[id] !== undefined) this.stop(id);
    else this.play(id);
  }

  stopAll() {
    for (const id of Object.keys(this.state.playing) as SoundId[]) this.stop(id);
  }

  setMaster(v: number) {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * sleepGain(this.left()), this.ctx.currentTime, 0.2);
    this.set({ master: v });
  }

  private left(): number | null {
    return this.state.sleepAt === null ? null : (this.state.sleepAt - Date.now()) / 1000;
  }

  /** Fades everything out and stops after `minutes`; null cancels the timer. */
  sleep(minutes: number | null) {
    window.clearInterval(this.sleepTimer);
    this.set({ sleepAt: minutes === null ? null : Date.now() + minutes * 60_000 });
    if (minutes === null) {
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.state.master, this.ctx.currentTime, 0.3);
      return;
    }
    this.sleepTimer = window.setInterval(() => {
      const left = this.left();
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.state.master * sleepGain(left), this.ctx.currentTime, 0.5);
      if (left !== null && left <= 0) {
        window.clearInterval(this.sleepTimer);
        this.stopAll();
        this.set({ sleepAt: null });
        if (this.master && this.ctx) this.master.gain.setValueAtTime(this.state.master, this.ctx.currentTime + 1.5);
      }
    }, 1000);
  }
}

export const sounds = new SoundEngine();
