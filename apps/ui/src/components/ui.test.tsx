import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIRM_GUARD_MS, ConfirmButton, confirmStep } from './ui';

describe('confirmStep', () => {
  it('the first tap arms, whenever it comes', () => {
    expect(confirmStep(false, 0, 5)).toBe('arm');
    expect(confirmStep(false, 1_000, 1_000_000)).toBe('arm');
  });
  it('a second tap that comes too soon (a double-tap or a bounce) is ignored', () => {
    expect(confirmStep(true, 1_000, 1_000)).toBe('ignore');
    expect(confirmStep(true, 1_000, 1_000 + CONFIRM_GUARD_MS - 1)).toBe('ignore');
  });
  it('a deliberate second tap confirms', () => {
    expect(confirmStep(true, 1_000, 1_000 + CONFIRM_GUARD_MS)).toBe('confirm');
    expect(confirmStep(true, 1_000, 3_000)).toBe('confirm');
  });
});

describe('ConfirmButton', () => {
  it('is an ordinary button that can be switched off', () => {
    const on = renderToStaticMarkup(<ConfirmButton label="Reset" onConfirm={() => {}} />);
    const off = renderToStaticMarkup(<ConfirmButton label="Reset" onConfirm={() => {}} disabled />);
    expect(on).not.toMatch(/\bdisabled\b/);
    expect(off).toMatch(/\bdisabled\b/);
    expect(on).toContain('data-armed="false"');
  });
});
