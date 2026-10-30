import { describe, expect, it } from 'vitest';
import { playChime } from './chime';

describe('playChime', () => {
  it('does nothing, without throwing, where there is no audio (a server, a test)', () => {
    expect(() => playChime()).not.toThrow();
    (globalThis as { window?: unknown }).window = { setTimeout };
    expect(() => playChime()).not.toThrow();
    delete (globalThis as { window?: unknown }).window;
  });
});
