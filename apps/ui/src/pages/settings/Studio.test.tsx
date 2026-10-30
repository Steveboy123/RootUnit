// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@headunit/shared';
import { useHeadUnit } from '../../store';
import { BackgroundSection, BeatSection } from './Studio';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INITIAL = useHeadUnit.getState();
let root: Root;
let host: HTMLElement;
let patchSettings: ReturnType<typeof vi.fn<(p: object) => void>>;

/** GET /api/wallpapers lists `files`; the upload answers with `upload` (status and body). */
function serve(files: string[], upload: { status: number; body: object }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/wallpapers/upload')) return new Response(JSON.stringify(upload.body), { status: upload.status });
    if (url === '/api/wallpapers') return new Response(JSON.stringify({ files: files.map((name) => ({ name, size: 1 })) }));
    return new Response('{}', { status: init?.method ? 200 : 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function pick(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  patchSettings = vi.fn<(p: object) => void>();
  useHeadUnit.setState({ settings: DEFAULT_SETTINGS, patchSettings });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useHeadUnit.setState(INITIAL, true);
  vi.unstubAllGlobals();
});

describe('Settings → Background: your own wallpaper', () => {
  it('uploads the picked picture, lists it and makes it the wallpaper', async () => {
    const fetchMock = serve([], { status: 201, body: { name: 'My car.jpg', id: 'user:My car.jpg' } });
    await act(async () => root.render(<BackgroundSection />));
    expect(host.textContent).toContain('Add your own picture');

    await pick(new File(['jpg'], 'My car.jpg', { type: 'image/jpeg' }));

    const post = fetchMock.mock.calls.find(([url]) => url.startsWith('/api/wallpapers/upload'))!;
    expect(post[0]).toBe('/api/wallpapers/upload?name=My%20car.jpg');
    expect(post[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' } });
    expect(patchSettings).toHaveBeenCalledWith({ background: 'wallpaper', wallpaper: 'user:My car.jpg' });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/wallpapers')).toHaveLength(2); // listed again, so the new tile shows
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Added and chosen as your wallpaper.');
  });

  it('shows the server’s reason when it refuses a file, and changes nothing', async () => {
    serve([], { status: 400, body: { error: 'That is not a PNG, JPEG, WebP or AVIF picture.' } });
    await act(async () => root.render(<BackgroundSection />));

    await pick(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));

    expect(patchSettings).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('That is not a PNG, JPEG, WebP or AVIF picture.');
    expect(host.querySelector<HTMLButtonElement>('.btn.small')?.disabled).toBe(false);
  });
});

describe('Settings → Music reactive: is it really listening?', () => {
  it('says what the head unit’s audio monitor reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ available: false, configured: false, error: 'No capture device is set.' }))));
    useHeadUnit.setState({ settings: { ...DEFAULT_SETTINGS, beatMode: 'glow', beatSource: 'system' } });
    await act(async () => root.render(<BeatSection />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('No capture device is set.');
    expect(host.textContent).not.toContain('Start microphone');
  });

  it('starts the microphone only from a tap, and says why when it cannot', async () => {
    useHeadUnit.setState({ settings: { ...DEFAULT_SETTINGS, beatMode: 'glow', beatSource: 'microphone' } });
    await act(async () => root.render(<BeatSection />));
    const [start, stop] = [...host.querySelectorAll<HTMLButtonElement>('button.btn.small')];
    expect(start!.textContent).toContain('Start microphone');
    expect(stop!.disabled).toBe(true); // nothing to stop yet
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Tap Start; the browser asks first.');

    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await act(async () => {
      start!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Microphone capture requires a secure context (HTTPS or localhost).');
  });
});
