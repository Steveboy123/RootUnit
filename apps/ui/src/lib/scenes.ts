import type { Scene } from '@headunit/shared';
import { apiSend } from './api';
import { useHeadUnit } from '../store';

export interface SceneEffect {
  /** What was done, for the toast and for tests. */
  done: string[];
  /** Things that failed (the lights could not be reached). The rest of the scene still happened. */
  failed: string[];
}

/**
 * Apply a scene: only what it names is touched. Each part is independent, so a light strip that is switched off does not
 * stop the screen from dimming. The screen does the work (it knows where it is and what is showing); the server only stores scenes.
 */
export async function applyScene(scene: Scene): Promise<SceneEffect> {
  const st = useHeadUnit.getState();
  const a = scene.actions;
  const out: SceneEffect = { done: [], failed: [] };

  if (a.theme) {
    // A scene that picks a look switches the automatic day/night change off: it asked for this look.
    st.patchSettings({ theme: a.theme, autoTheme: false });
    out.done.push('look');
  }
  const system: { brightness?: number; volume?: number } = {};
  if (a.brightness !== undefined) system.brightness = a.brightness;
  if (a.volume !== undefined) system.volume = a.volume;
  if (Object.keys(system).length) {
    st.patchSystem(system);
    if (system.brightness !== undefined) out.done.push('brightness');
    if (system.volume !== undefined) out.done.push('volume');
  }
  if (a.lights) {
    const r = await apiSend('/api/lighting/update', { enabled: a.lights.enabled, ...(a.lights.color ? { color: a.lights.color } : {}), ...(a.lights.brightness ? { brightness: a.lights.brightness } : {}) });
    (r.error ? out.failed : out.done).push('lights');
  }
  if (a.go) st.go(a.go === 'apps' ? 'apps' : a.go);
  if (a.standby) st.setStandby(true);
  return out;
}

/** "Night drive: look, brightness and lights" for the confirmation toast. */
export function sceneSummary(scene: Scene, effect: SceneEffect): string {
  const list = (items: string[]) => items.join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (effect.failed.length) return `${scene.name}: ${list(effect.done) || 'nothing'} set. Could not reach the ${list(effect.failed)}.`;
  return effect.done.length ? `${scene.name}: ${list(effect.done)}` : scene.name;
}
