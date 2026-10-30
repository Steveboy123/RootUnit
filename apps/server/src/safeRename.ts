import { rename as fsRename } from 'node:fs/promises';

/** The errors Windows gives while another program (an antivirus scan, the search indexer, an editor) briefly holds the target open. */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * `rename`, retried for a moment on Windows when the target is briefly held open by another program. Linux and macOS replace a file
 * atomically whoever has it open, so there the first error is the answer. Node's own graceful-fs does the same on Windows.
 */
export async function safeRename(
  from: string,
  to: string,
  opts: { rename?: (a: string, b: string) => Promise<void>; platform?: NodeJS.Platform; wait?: (ms: number) => Promise<void>; attempts?: number } = {},
): Promise<void> {
  const rename = opts.rename ?? fsRename;
  const windows = (opts.platform ?? process.platform) === 'win32';
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = windows ? (opts.attempts ?? 8) : 1;
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (i >= attempts || !TRANSIENT.has((err as NodeJS.ErrnoException)?.code ?? '')) throw err;
      await wait(Math.min(400, 25 * 2 ** i));
    }
  }
}
