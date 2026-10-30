import type { CameraState } from '@headunit/shared';
import { Observable } from '../observable';

/**
 * Whether the reverse-camera overlay is showing. The video itself is captured by the browser
 * (getUserMedia); this just lets anything — the UI, a GPIO script wired to the reverse light,
 * curl — turn it on and off.
 */
export function createCamera() {
  const state = new Observable<CameraState>({ active: false });
  return {
    state,
    show: () => state.set({ active: true }),
    hide: () => state.set({ active: false }),
    toggle: () => state.set({ active: !state.get().active }),
  };
}
export type CameraProvider = ReturnType<typeof createCamera>;
