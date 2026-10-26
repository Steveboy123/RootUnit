import type { IncomingMessage, ServerResponse } from 'node:http';
import { BodyTooLarge, json, readJson } from '../http';
import { FmError, type FmService } from './service';

/** Every FM request is a few short fields. */
const BODY_LIMIT = 1024;

/**
 * `/api/fm/*`: the screens' side of the FM transmitter. Returns true when it answered. Host and Origin protection is applied by the
 * server before this is reached, for every method that changes anything. Bodies are small and checked; unknown fields are ignored.
 */
export function createFmRoutes(fm: FmService) {
  return async function handle(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<boolean> {
    if (!path.startsWith('/api/fm/')) return false;
    const body = () => readJson(req, BODY_LIMIT) as Promise<Record<string, unknown>>;
    try {
      if (path === '/api/fm/status' && method === 'GET') return json(res, 200, fm.state.get()), true;
      if (path === '/api/fm/tune' && method === 'POST') return json(res, 200, await fm.tune((await body()).frequency)), true;
      if (path === '/api/fm/power' && method === 'POST') return json(res, 200, await fm.setOn((await body()).on)), true;
      if (path === '/api/fm/acknowledge' && method === 'POST') return json(res, 200, await fm.acknowledge((await body()).version)), true;
      if (path === '/api/fm/preset' && method === 'POST') {
        const b = await body();
        return json(res, 200, await fm.togglePreset(b.frequency, b.saved)), true;
      }
      return false;
    } catch (e) {
      if (e instanceof BodyTooLarge) throw e; // the server answers 413
      if (e instanceof FmError) return json(res, e.status, { error: e.message }), true;
      throw e;
    }
  };
}
