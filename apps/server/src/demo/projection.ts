import type { ProjectionState } from '@headunit/shared';
import { Observable } from '../observable';
import type { ProjectionProvider } from '../providers/projection';

/** How long the pretend phone takes to "connect" after Launch. */
const CONNECT_MS = 1200;

/** A stand-in Android Auto session: idle → starting → active → idle. Demo mode only; production never fakes a projection. */
export function createMockProjection(): ProjectionProvider {
  const state = new Observable<ProjectionState>({ provider: 'external', mode: 'ondemand', running: false, status: 'idle', detail: 'Demo mode: no phone is projecting' });
  let timer: NodeJS.Timeout | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    state,
    start() {},
    async launch() {
      if (state.get().status === 'starting' || state.get().status === 'active') return;
      clear();
      state.update({ status: 'starting', running: true, detail: 'Demo: connecting to a pretend phone…' });
      timer = setTimeout(() => state.update({ status: 'active', running: true, detail: 'Demo Android Auto session' }), CONNECT_MS);
      timer.unref();
    },
    async stop() {
      clear();
      state.update({ status: 'idle', running: false, detail: 'Demo mode: no phone is projecting' });
    },
    dispose: clear,
  };
}
