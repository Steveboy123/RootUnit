/** A short three-note alert tone made with the Web Audio API (no sound file to ship). Quietly does nothing where audio is unavailable. */
export function playChime(volume = 0.5): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes: Array<[number, number]> = [
      [880, 0],
      [1175, 0.22],
      [1568, 0.44],
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1500);
  } catch {
    /* no audio device, or the browser refused: the on-screen alarm still shows */
  }
}
