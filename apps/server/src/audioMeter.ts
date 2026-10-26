import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Real 16 kHz mono PCM audio meter. Reads a user-configured ALSA CAPTURE / monitor
 * device. Does not assume Spotify's control API exposes audio samples and never
 * manufactures beats from song metadata. Disabled unless HEADUNIT_BEAT_DEVICE is set.
 *
 * Example: HEADUNIT_BEAT_DEVICE=plughw:Loopback,1,0 (after routing a copy of the
 * music output into the other side of snd-aloop).
 */
export class AudioMeter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private error = '';
  private started = false;
  private sample = { level: 0, bass: 0, beat: 0, updatedAt: 0 };
  private lp = 0;
  private avgBass = 0.025;
  private samples = 0;
  private square = 0;
  private bassSquare = 0;
  private lastBeat = 0;
  private leftovers: Buffer = Buffer.alloc(0);

  constructor(private readonly device: string | undefined = process.env.HEADUNIT_BEAT_DEVICE) {}

  state() {
    if (this.device && !this.started) this.start();
    const stale = Date.now() - this.sample.updatedAt > 500;
    return {
      available: Boolean(this.device && this.child && !this.error && !stale),
      configured: Boolean(this.device),
      error: !this.device ? 'Set HEADUNIT_BEAT_DEVICE to an ALSA capture/monitor device.' : this.error,
      level: stale ? 0 : this.sample.level,
      bass: stale ? 0 : this.sample.bass,
      beat: stale ? 0 : this.sample.beat,
    };
  }

  private start() {
    if (!this.device || this.started) return;
    this.started = true;
    // spawn arguments, no shell and no user-supplied executable.
    const child = spawn('arecord', ['-q', '-D', this.device, '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw'], { stdio: 'pipe' });
    this.child = child;
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString('utf8')).slice(-350); });
    child.stdout.on('data', (data: Buffer) => this.consume(data));
    child.on('error', (e) => { this.error = `Cannot start arecord: ${e.message}`; this.child = null; });
    child.on('close', (code) => {
      this.child = null;
      if (!this.error) this.error = `ALSA capture stopped (${code ?? 'unknown'}). ${stderr}`.trim();
    });
  }

  private consume(incoming: Buffer) {
    const buf = this.leftovers.length ? Buffer.concat([this.leftovers, incoming]) : incoming;
    const end = buf.length - (buf.length % 2);
    this.leftovers = end < buf.length ? Buffer.from(buf.subarray(end)) : Buffer.alloc(0);
    // 100 ms frames, computed off-main-thread on the server. Bass filter ~190 Hz.
    for (let i = 0; i < end; i += 2) {
      const x = buf.readInt16LE(i) / 32768;
      this.lp += 0.073 * (x - this.lp);
      this.square += x * x;
      this.bassSquare += this.lp * this.lp;
      if (++this.samples !== 1600) continue;
      const rms = Math.sqrt(this.square / this.samples);
      const bass = Math.sqrt(this.bassSquare / this.samples);
      const now = Date.now();
      const transient = bass > Math.max(0.008, this.avgBass * 1.55) && now - this.lastBeat > 180;
      if (transient) this.lastBeat = now;
      this.avgBass = this.avgBass * 0.93 + bass * 0.07;
      this.sample = {
        level: Math.min(1, Math.max(0, rms * 5)),
        bass: Math.min(1, Math.max(0, bass * 8)),
        beat: transient ? 1 : 0,
        updatedAt: now,
      };
      this.samples = 0;
      this.square = 0;
      this.bassSquare = 0;
    }
  }

  close() {
    this.child?.kill('SIGTERM');
    this.child = null;
  }
}
