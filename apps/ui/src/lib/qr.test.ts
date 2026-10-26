import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { makeQr, modulesToPath, qrModules, QUIET_ZONE } from './qr';

/** Typical sign-in addresses are 300–450 characters (PKCE challenge, state, scopes). */
const address = (n: number) => {
  const base = 'https://accounts.spotify.com/authorize?client_id=0123456789abcdef0123456789abcdef&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fauth%2Fspotify%2Fcallback&code_challenge_method=S256&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&state=';
  return base + 'a'.repeat(Math.max(0, n - base.length));
};

/** Rebuild the module grid from the SVG path, to prove the path says exactly what the code says. */
function gridFromPath(path: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < w; i++) grid[y]![x + i] = true;
  }
  return grid;
}

describe('qrModules / makeQr', () => {
  it('encodes 300–450 character addresses at a size a small screen can show', () => {
    for (const n of [300, 380, 450]) {
      const rows = qrModules(address(n));
      expect(rows, `${n} chars`).not.toBeNull();
      const size = rows!.length;
      // size = 17 + 4 × version. Version 15 or lower keeps each module ≥ 3 px at 264 px wide.
      expect((size - 17) % 4).toBe(0);
      expect(size).toBeLessThanOrEqual(17 + 4 * 15);
    }
  });

  it('draws the three finder squares and timing lines of a real QR code', () => {
    const rows = qrModules(address(380))!;
    const n = rows.length;
    const finder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++)
        for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          // 3 = dark outer ring, 2 = light ring, ≤1 = dark centre
          expect(rows[r0 + r]![c0 + c], `finder at ${r0},${c0} cell ${r},${c}`).toBe(ring !== 2);
        }
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) {
      expect(rows[6]![i]).toBe(i % 2 === 0);
      expect(rows[i]![6]).toBe(i % 2 === 0);
    }
  });

  it('is deterministic', () => {
    expect(makeQr(address(400))).toEqual(makeQr(address(400)));
  });

  it('the SVG path reproduces every module exactly', () => {
    const text = address(420);
    const qr = makeQr(text)!;
    const rows = qrModules(text)!;
    expect(qr.size).toBe(rows.length);
    const drawn = gridFromPath(qr.path, qr.size);
    expect(drawn).toEqual(rows);
    // …and matches the library's own idea of the code (independent of our row reading).
    const lib = qrcode(0, 'L');
    lib.addData(text, 'Byte');
    lib.make();
    let differing = 0;
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (drawn[y]![x] !== lib.isDark(y, x)) differing++;
    expect(differing).toBe(0);
  });

  it('returns null for text no QR code can hold', () => {
    expect(qrModules('x'.repeat(4000))).toBeNull();
    expect(makeQr('x'.repeat(4000))).toBeNull();
  });

  it('keeps a quiet zone of 4 modules, as the standard asks', () => {
    expect(QUIET_ZONE).toBe(4);
  });
});

describe('modulesToPath', () => {
  it('merges horizontal runs and skips light modules', () => {
    expect(modulesToPath([[true, true, false, true], [false, false, false, false], [false, true, true, true]])).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z');
    expect(modulesToPath([])).toBe('');
  });
});
