import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

/** A just-enough document: a textarea we can see being selected, and a copy command that succeeds or not. */
function fakeDocument(copySucceeds: boolean) {
  const area = {
    value: '',
    style: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    selected: false,
    removed: false,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    focus() {},
    select() {
      this.selected = true;
    },
    setSelectionRange() {},
    remove() {
      this.removed = true;
    },
  };
  const doc = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => area),
    execCommand: vi.fn(() => copySucceeds),
  };
  return { doc, area };
}

describe('copyText', () => {
  it('uses the Clipboard API when there is one', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a textarea and execCommand when the API is missing', async () => {
    const { doc, area } = fakeDocument(true);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', doc);
    expect(await copyText('http://127.0.0.1:8787/auth/spotify/callback')).toBe(true);
    expect(area.value).toBe('http://127.0.0.1:8787/auth/spotify/callback');
    expect(area.selected).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(area.removed).toBe(true); // never leaves the helper element behind
  });

  it('falls back when the API refuses (insecure page, permission denied)', async () => {
    const { doc } = fakeDocument(true);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.stubGlobal('document', doc);
    expect(await copyText('x')).toBe(true);
    expect(doc.execCommand).toHaveBeenCalled();
  });

  it('reports failure when neither way works', async () => {
    const { doc, area } = fakeDocument(false);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', doc);
    expect(await copyText('x')).toBe(false);
    expect(area.removed).toBe(true);
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {});
    expect(await copyText('x')).toBe(false); // no document at all
  });
});
