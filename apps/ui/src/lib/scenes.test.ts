import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '@headunit/shared';
import { DEFAULT_SETTINGS } from '@headunit/shared';
import { useHeadUnit } from '../store';
import { applyScene, sceneSummary } from './scenes';

const scene = (actions: Scene['actions']): Scene => ({ id: 'abc12345', name: 'Night drive', icon: 'moon', actions });

describe('applyScene', () => {
  const patchSettings = vi.fn();
  const patchSystem = vi.fn();
  const go = vi.fn();
  const setStandby = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    useHeadUnit.setState({ settings: { ...DEFAULT_SETTINGS }, patchSettings, patchSystem, go, setStandby } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('touches only what the scene names', async () => {
    const r = await applyScene(scene({ brightness: 30 }));
    expect(patchSystem).toHaveBeenCalledWith({ brightness: 30 });
    expect(patchSettings).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(setStandby).not.toHaveBeenCalled();
    expect(r).toEqual({ done: ['brightness'], failed: [] });
  });

  it('a chosen look switches the automatic day/night change off', async () => {
    await applyScene(scene({ theme: 'ember' }));
    expect(patchSettings).toHaveBeenCalledWith({ theme: 'ember', autoTheme: false });
  });

  it('does everything a full scene says, in one go', async () => {
    const r = await applyScene(scene({ theme: 'midnight', brightness: 35, volume: 20, lights: { enabled: true, color: '#2a4bff', brightness: 40 }, go: 'drive', standby: true }));
    expect(patchSystem).toHaveBeenCalledWith({ brightness: 35, volume: 20 });
    expect(fetchMock).toHaveBeenCalledWith('/api/lighting/update', expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: true, color: '#2a4bff', brightness: 40 }) }));
    expect(go).toHaveBeenCalledWith('drive');
    expect(setStandby).toHaveBeenCalledWith(true);
    expect(r.done).toEqual(['look', 'brightness', 'volume', 'lights']);
  });

  it('turns the lights off with just that', async () => {
    await applyScene(scene({ lights: { enabled: false } }));
    expect(fetchMock).toHaveBeenCalledWith('/api/lighting/update', expect.objectContaining({ body: JSON.stringify({ enabled: false }) }));
  });

  it('a light strip that cannot be reached does not stop the rest, and is reported', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Enter your ESP WLED IPv4 address' }) });
    const r = await applyScene(scene({ brightness: 20, lights: { enabled: true } }));
    expect(patchSystem).toHaveBeenCalled();
    expect(r).toEqual({ done: ['brightness'], failed: ['lights'] });
  });
});

describe('sceneSummary', () => {
  const s = scene({});
  it('says what happened', () => {
    expect(sceneSummary(s, { done: ['look', 'brightness', 'lights'], failed: [] })).toBe('Night drive: look, brightness and lights');
    expect(sceneSummary(s, { done: ['volume'], failed: [] })).toBe('Night drive: volume');
    expect(sceneSummary(s, { done: [], failed: [] })).toBe('Night drive');
  });
  it('says what could not be done', () => {
    expect(sceneSummary(s, { done: ['brightness'], failed: ['lights'] })).toBe('Night drive: brightness set. Could not reach the lights.');
    expect(sceneSummary(s, { done: [], failed: ['lights'] })).toBe('Night drive: nothing set. Could not reach the lights.');
  });
});
