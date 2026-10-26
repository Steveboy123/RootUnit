import { describe, expect, it } from 'vitest';
import { IcyDemux, parseStreamTitle } from './icy';

describe('parseStreamTitle', () => {
  it('extracts the title', () => {
    expect(parseStreamTitle("StreamTitle='Daft Punk - One More Time';StreamUrl='';")).toBe('Daft Punk - One More Time');
  });
  it('keeps apostrophes inside titles', () => {
    expect(parseStreamTitle("StreamTitle='Don't Stop Believin';StreamUrl='x';")).toBe("Don't Stop Believin");
    expect(parseStreamTitle("StreamTitle='Rock 'n' Roll';")).toBe("Rock 'n' Roll");
  });
  it('handles padding, missing semicolon and empty titles', () => {
    expect(parseStreamTitle("StreamTitle='X';\0\0\0\0")).toBe('X');
    expect(parseStreamTitle("StreamTitle='No semicolon'")).toBe('No semicolon');
    expect(parseStreamTitle("StreamTitle='';")).toBeUndefined();
    expect(parseStreamTitle('garbage')).toBeUndefined();
  });
});

function block(title: string | null): Buffer {
  if (title === null) return Buffer.from([0]);
  const text = Buffer.from(`StreamTitle='${title}';`);
  const len = Math.ceil(text.length / 16);
  return Buffer.concat([Buffer.from([len]), text, Buffer.alloc(len * 16 - text.length)]);
}

/** Deterministic PRNG so failures are reproducible. */
function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

async function demux(wire: Buffer, metaint: number, chunkSizes: () => number) {
  const titles: Array<string | undefined> = [];
  const d = new IcyDemux(metaint, (t) => titles.push(t));
  const out: Buffer[] = [];
  d.on('data', (b: Buffer) => out.push(b));
  const done = new Promise((r) => d.on('end', r));
  for (let i = 0; i < wire.length; ) {
    const n = Math.max(1, chunkSizes());
    d.write(wire.subarray(i, i + n));
    i += n;
  }
  d.end();
  await done;
  return { audio: Buffer.concat(out), titles };
}

describe('IcyDemux', () => {
  const metaint = 64;
  const audio = Buffer.from(Array.from({ length: metaint * 12 }, (_, i) => (i * 7 + 3) % 251));
  const titles = ['Artist - One', null, "Don't Stop", null, 'A much longer title that spans more than one sixteen-byte unit of padding', null, null, 'Seven', null, 'x', null, null];
  const wire = Buffer.concat(titles.flatMap((t, i) => [audio.subarray(i * metaint, (i + 1) * metaint), block(t)]));

  it('returns the audio untouched and reports every title', async () => {
    const r = await demux(wire, metaint, () => wire.length);
    expect(r.audio.equals(audio)).toBe(true);
    expect(r.titles).toEqual(['Artist - One', "Don't Stop", 'A much longer title that spans more than one sixteen-byte unit of padding', 'Seven', 'x']);
  });

  it('is correct for every chunk size, including 1-byte chunks', async () => {
    for (const size of [1, 2, 3, 7, 16, 17, 63, 64, 65, 100, 1000]) {
      const r = await demux(wire, metaint, () => size);
      expect(r.audio.equals(audio), `chunk size ${size}`).toBe(true);
      expect(r.titles).toHaveLength(5);
    }
  });

  it('survives 200 random chunkings', async () => {
    const rnd = lcg(42);
    for (let i = 0; i < 200; i++) {
      const r = await demux(wire, metaint, () => Math.floor(rnd() * 90) + 1);
      expect(r.audio.equals(audio)).toBe(true);
      expect(r.titles).toHaveLength(5);
    }
  });

  it('rejects a bad metaint', () => {
    expect(() => new IcyDemux(0, () => {})).toThrow();
    expect(() => new IcyDemux(1.5, () => {})).toThrow();
  });
});
