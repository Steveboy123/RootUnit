import type { IncomingMessage, ServerResponse } from 'node:http';

/** The request body was over the limit. */
export class BodyTooLarge extends Error {}

/** Most requests are tiny; this is the default cap. Bigger documents (notes, a backup) ask for their own. */
export const DEFAULT_BODY_LIMIT = 8 * 1024;

/**
 * Read a JSON request body. Rejects with `BodyTooLarge` as soon as the limit is passed (it stops buffering at once, so a
 * hostile upload cannot fill memory). Anything that is not a JSON object reads as `{}`.
 */
export function readJson(req: IncomingMessage, limit = DEFAULT_BODY_LIMIT): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return void reject(new BodyTooLarge('body too large'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
