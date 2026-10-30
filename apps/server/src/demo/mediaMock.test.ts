import { describe, expect, it } from 'vitest';
import { createMockMedia } from './mediaMock';

function setup() {
  let t = 1_000_000;
  const m = createMockMedia(() => t);
  return { m, advance: (ms: number) => void (t += ms) };
}

describe('mock media', () => {
  it('plays, pauses and tracks progress', async () => {
    const { m, advance } = setup();
    await m.command({ cmd: 'play' });
    advance(5000);
    await m.command({ cmd: 'pause' });
    expect(m.state.get().playing).toBe(false);
    expect(m.state.get().progressMs).toBe(5000);
    advance(60_000);
    expect(m.state.get().progressMs).toBe(5000); // paused: no drift
  });

  it('prev restarts after 3s, otherwise goes back; wraps around', async () => {
    const { m, advance } = setup();
    await m.command({ cmd: 'next' });
    const second = m.state.get().track!.id;
    await m.command({ cmd: 'play' });
    advance(5000);
    await m.command({ cmd: 'prev' });
    expect(m.state.get().track!.id).toBe(second);
    expect(m.state.get().progressMs).toBe(0);
    await m.command({ cmd: 'prev' });
    await m.command({ cmd: 'prev' });
    expect(m.state.get().track).not.toBeNull();
  });

  it('auto-advances at track end and stops at queue end when repeat is off', async () => {
    const { m, advance } = setup();
    await m.command({ cmd: 'playContext', uri: 'mock:playlist:3' }); // 2 tracks
    const first = m.state.get().track!;
    advance(first.durationMs + 10);
    m.tick();
    expect(m.state.get().track!.id).not.toBe(first.id);
    advance(m.state.get().track!.durationMs + 10);
    m.tick();
    expect(m.state.get().playing).toBe(false);
  });

  it('clamps seek and volume', async () => {
    const { m } = setup();
    await m.command({ cmd: 'seek', positionMs: 99_999_999 });
    expect(m.state.get().progressMs).toBe(m.state.get().track!.durationMs);
    await m.command({ cmd: 'volume', volume: 400 });
    expect(m.state.get().volume).toBe(100);
  });
});
