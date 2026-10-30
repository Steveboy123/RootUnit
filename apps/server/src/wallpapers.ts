import { constants as fsConstants, createReadStream } from 'node:fs';
import { lstat, open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream';

/**
 * Wallpapers: pictures the user drops into data/wallpapers/ and picks in Settings > Appearance.
 *
 *   GET /api/wallpapers        -> { files: [{ name, size }] }
 *   GET /api/wallpapers/:name  -> the image
 *
 * The folder is the only thing served, and only by exact file name. A request is answered with the image only if ALL of this holds:
 *   - the name, decoded exactly once, is a plain file name (WALLPAPER_NAME_RE, no "..", not a Windows device name) with a whitelisted image extension;
 *   - lstat says it is a regular file (so no symlink, directory, FIFO or socket) no bigger than WALLPAPER_MAX_BYTES, checked before a byte is read;
 *   - realpath stays inside the real wallpapers folder;
 *   - the file we then open (O_NOFOLLOW, O_NONBLOCK) is still that same regular file (fstat: type, size and inode), so swapping it for a link
 *     or a FIFO between the checks and the open gains nothing.
 * Every refusal is the same 404, so the response says nothing about what exists, and nothing sent ever contains a path.
 * (A hard link to a file elsewhere is a regular file in this folder and is served: creating one takes access to the folder, which is
 * already more than the HTTP API grants.)
 */

/** The biggest image listed or served. A larger file is simply not there. */
export const WALLPAPER_MAX_BYTES = 12 * 1024 * 1024;
/** The listing is cut here (after sorting); a file past it can still be fetched by name. */
export const WALLPAPER_MAX_FILES = 100;
/** A file name we are willing to look up: starts with a letter or digit, then letters, digits, dot, underscore, hyphen, space. */
export const WALLPAPER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;

/** Extension -> Content-Type. Deliberately no svg (scripts) and no html. */
const TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
]);
export const WALLPAPER_EXTENSIONS: readonly string[] = [...TYPES.keys()];

/** CON, NUL, COM1 ... mean a device, not a file, on Windows (even with an extension). */
const DEVICE_NAME_RE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/** The Content-Type for a file name that is safe to look up, or undefined for anything else. */
export function wallpaperContentType(name: string): string | undefined {
  if (typeof name !== 'string' || !WALLPAPER_NAME_RE.test(name) || name.includes('..') || DEVICE_NAME_RE.test(name)) return undefined;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? TYPES.get(name.slice(dot).toLowerCase()) : undefined;
}

/**
 * One path segment of the request -> the file name it asks for. The segment is percent-decoded exactly once (so "%252e%252e" stays the
 * text "%2e%2e" and is refused); null for a malformed escape or a name wallpaperContentType() would not accept.
 */
export function decodeWallpaperName(segment: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return wallpaperContentType(name) ? name : null;
}

export interface WallpaperFile {
  name: string;
  size: number;
}

/** O_NOFOLLOW / O_NONBLOCK do not exist on Windows (undefined there). NONBLOCK keeps open() on a FIFO swapped in at the last moment from hanging. */
const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** lstat: only a real regular file within the size cap qualifies. Never follows a link. */
async function regularFile(file: string) {
  try {
    const st = await lstat(file);
    return st.isFile() && st.size <= WALLPAPER_MAX_BYTES ? st : null;
  } catch {
    return null;
  }
}

/** The pictures in `dir`, sorted by name (plain code-unit order), at most WALLPAPER_MAX_FILES. A missing folder is an empty list; nothing is created. */
async function listWallpapers(dir: string): Promise<WallpaperFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: WallpaperFile[] = [];
  for (const name of names.filter((n) => wallpaperContentType(n)).sort(byName)) {
    if (files.length >= WALLPAPER_MAX_FILES) break;
    const st = await regularFile(join(dir, name));
    if (st) files.push({ name, size: st.size });
  }
  return files;
}

interface OpenWallpaper {
  handle: FileHandle;
  size: number;
  mtimeMs: number;
  type: string;
}

/** Run every check above and hand back an open file descriptor, or null. The caller must close `handle` (or give it to a stream). */
async function openWallpaper(dir: string, name: string): Promise<OpenWallpaper | null> {
  const type = wallpaperContentType(name);
  if (!type) return null;
  const file = join(dir, name); // `name` has no separator, so this is a direct child of `dir`
  const before = await regularFile(file);
  if (!before) return null;

  // The folder itself may be a symlink (data/wallpapers -> a photo library), but the file has to resolve to a direct child of the real folder.
  const [realDir, realFile] = await Promise.all([realpath(dir), realpath(file)]);
  const rel = relative(realDir, realFile);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.includes(sep)) return null;

  const handle = await open(file, OPEN_FLAGS);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > WALLPAPER_MAX_BYTES || st.ino !== before.ino || st.dev !== before.dev) {
      await handle.close();
      return null;
    }
    return { handle, size: st.size, mtimeMs: st.mtimeMs, type };
  } catch (e) {
    await handle.close().catch(() => {});
    throw e;
  }
}

/** Does an If-None-Match header match this ETag? (weak comparison, "*" and comma lists included) */
function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return false;
  if (value.trim() === '*') return true;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  const mine = bare(etag);
  return value.split(',').some((t) => bare(t) === mine);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

/** The one answer to anything invalid or missing: same status, headers and body whatever the reason. */
const notFound = (res: ServerResponse) => sendJson(res, 404, { error: 'not found' });

export interface Wallpapers {
  /** The files that would be listed right now. */
  list(): Promise<WallpaperFile[]>;
  /** Answer GET/HEAD for `pathname` (either /api/wallpapers route). Any other method is "not found". */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
}

/** The wallpaper routes for the folder `dir`. The folder is only ever read: it does not need to exist and is never created. */
export function createWallpapers(dir: string): Wallpapers {
  async function serve(req: IncomingMessage, res: ServerResponse, segment: string, head: boolean) {
    const name = decodeWallpaperName(segment);
    if (!name) return notFound(res);
    let opened: OpenWallpaper | null = null;
    try {
      opened = await openWallpaper(dir, name);
    } catch {
      opened = null; // permissions, a file vanishing mid-check: the same answer as "no such file", never a 500 or an error message
    }
    if (!opened) return notFound(res);

    let streaming = false;
    try {
      const { handle, size, mtimeMs, type } = opened;
      // Stat-derived, so weak: changes whenever the file is replaced (size or modification time).
      const etag = `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
      const headers = { 'Cache-Control': 'public, max-age=86400', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.writeHead(304, headers).end();
        return;
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': type,
        'Content-Length': size,
        // If someone opens the address directly it is an inert picture; and other sites cannot embed it to probe which files exist.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-site',
      });
      if (head || size === 0 || res.destroyed) {
        res.end();
        return;
      }
      // `end` pins the read to the size we checked, even if the file grows afterwards. The stream owns the descriptor from here on.
      const stream = createReadStream(join(dir, name), { fd: handle, start: 0, end: size - 1 });
      streaming = true;
      // pipeline() destroys the stream (closing the file) when the client goes away, and ends the response when the file ends.
      pipeline(stream, res, (err) => {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (err && code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn('[wallpapers] a file could not be sent completely:', code ?? 'error'); // never the path
      });
    } finally {
      if (!streaming) await opened.handle.close().catch(() => {});
    }
  }

  return {
    list: () => listWallpapers(dir),
    async handle(req, res, pathname) {
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') return notFound(res);
      if (pathname === '/api/wallpapers') return sendJson(res, 200, { files: await listWallpapers(dir) });
      const m = /^\/api\/wallpapers\/([^/]+)$/.exec(pathname);
      if (!m) return notFound(res);
      return serve(req, res, m[1]!, method === 'HEAD');
    },
  };
}

/** Safe browser upload for local custom wallpaper selection. The only accepted bodies are
 * actual PNG/JPEG/WebP/AVIF files <= 12 MiB, stored as new files without overwriting.
 * No SVG, scripts, path separators, or trust in the browser's MIME declaration.
 */
export async function uploadWallpaper(req: IncomingMessage, dir: string, name: string): Promise<string> {
  const type = wallpaperContentType(name);
  if (!type) throw new Error('Use a plain .png, .jpg, .jpeg, .webp or .avif filename.');
  const declared = (req.headers['content-type'] ?? '').split(';')[0]!.toLowerCase();
  if (declared !== type) throw new Error('Image format does not match its filename.');
  const len = Number(req.headers['content-length']);
  if (!Number.isFinite(len) || len < 8 || len > WALLPAPER_MAX_BYTES) throw new Error('Picture must be smaller than 12 MB.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > WALLPAPER_MAX_BYTES) throw new Error('Picture is too large.');
    chunks.push(b);
  }
  const body = Buffer.concat(chunks);
  if (body.length !== len) throw new Error('Incomplete picture.');
  const signature = type === 'image/png' ? body.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'image/jpeg' ? body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
    : type === 'image/webp' ? body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
    : body.toString('ascii', 4, 12).includes('ftypavif');
  if (!signature) throw new Error('File contents are not a valid image of that type.');
  const { mkdir, open } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot).slice(0, 83);
  const ext = name.slice(dot);
  for (let n = 0; n < 1000; n++) {
    const candidate = n ? `${base}-${n}${ext}` : name;
    let h: FileHandle;
    try { h = await open(join(dir, candidate), 'wx', 0o600); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; throw e; }
    try { await h.writeFile(body); }
    catch (e) { await h.close(); const { unlink } = await import('node:fs/promises'); await unlink(join(dir, candidate)).catch(() => {}); throw e; }
    await h.close();
    return candidate;
  }
  throw new Error('Too many wallpapers with this name.');
}
