/** Audio readings are real sampled PCM, never track metadata or a fake timer. */
export interface MeterReading {
  available: boolean;
  configured: boolean;
  level: number;
  bass: number;
  beat: number;
  /** Loudness per frequency band, low to high (0..1). Only the microphone source has them; the Pi meter reports level and bass. */
  bands?: number[];
  error?: string;
}

/** How many bands readMicrophoneMeter reports (log-spaced from 40 Hz to 12 kHz). */
export const BAND_COUNT = 16;
export const QUIET: MeterReading = { available: false, configured: false, level: 0, bass: 0, beat: 0 };

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let spectrum: Uint8Array<ArrayBuffer> | null = null;
let ambientBass = 0.035;
let lastBeat = 0;

/** Must be called by a direct touch/click so microphone permission is explicit. */
export async function enableMicrophoneMeter(): Promise<void> {
  stopMicrophoneMeter();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture requires a secure context (HTTPS or localhost).');
  const requested = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  try {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(requested);
    const node = ctx.createAnalyser();
    node.fftSize = 1024;
    node.smoothingTimeConstant = 0.62;
    source.connect(node); // Never connect the microphone to speakers: no feedback.
    await ctx.resume();
    stream = requested;
    context = ctx;
    analyser = node;
    spectrum = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
    ambientBass = 0.035;
  } catch (e) {
    requested.getTracks().forEach(t => t.stop());
    throw e;
  }
}
export function microphoneIsOn() { return !!analyser && !!stream?.active; }
export function stopMicrophoneMeter() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  analyser = null;
  spectrum = null;
  const ctx = context;
  context = null;
  if (ctx) void ctx.close();
}
export function readMicrophoneMeter(): MeterReading {
  if (!analyser || !spectrum || !context) return { ...QUIET, error: 'Tap Start microphone in Settings → Music reactive to grant permission.' };
  analyser.getByteFrequencyData(spectrum);
  // Frequencies in 60–220 Hz; these are the kick/bass frequencies, not volume metadata.
  const hzPerBin = context.sampleRate / analyser.fftSize;
  const lo = Math.max(1, Math.floor(60 / hzPerBin));
  const hi = Math.min(spectrum.length - 1, Math.ceil(220 / hzPerBin));
  let total = 0; let bass = 0;
  for (let i = 1; i < spectrum.length; i++) total += spectrum[i]!;
  for (let i = lo; i <= hi; i++) bass += spectrum[i]!;
  const level = Math.min(1, total / ((spectrum.length - 1) * 255) * 2.1);
  const low = Math.min(1, bass / (Math.max(1, hi - lo + 1) * 255));
  const now = performance.now();
  const hit = low > Math.max(0.09, ambientBass * 1.55) && now - lastBeat > 180;
  if (hit) lastBeat = now;
  ambientBass = ambientBass * 0.967 + low * 0.033;
  // Log-spaced bands, so the bars spread like an equaliser rather than piling up in the treble.
  const bands: number[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    const f0 = 40 * (12000 / 40) ** (b / BAND_COUNT);
    const f1 = 40 * (12000 / 40) ** ((b + 1) / BAND_COUNT);
    const i0 = Math.max(1, Math.floor(f0 / hzPerBin));
    const i1 = Math.min(spectrum.length - 1, Math.max(i0, Math.ceil(f1 / hzPerBin)));
    let sum = 0;
    for (let i = i0; i <= i1; i++) sum += spectrum[i]!;
    bands.push(Math.min(1, (sum / (i1 - i0 + 1) / 255) * 1.35));
  }
  return { available: true, configured: true, level, bass: low, beat: hit ? 1 : 0, bands };
}
