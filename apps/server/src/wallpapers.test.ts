import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createSocketServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from '@headunit/shared';
import { config } from './config';
import { createMusic } from './connections/music';
import { Observable } from './observable';
import { createCamera } from './providers/camera';
import { createSimDevices } from './demo/devicesSim';
import { createMockMedia } from './demo/mediaMock';
import { createMockProjection } from './demo/projection';
import { createVehicleSim } from './demo/vehicleSim';
import { createRadio } from './radio/radio';
import { createApp } from './server';
import { JsonStore } from './store';
import { createSimSystem } from './demo/system';
import {
  WALLPAPER_MAX_BYTES,
  WALLPAPER_MAX_FILES,
  createWallpapers,
  decodeWallpaperName,
  wallpaperContentType,
} from './wallpapers';

const SECRET = 'TOP-SECRET-DO-NOT-SERVE';
const NOT_FOUND = JSON.stringify({ error: 'not found' });
const onWindows = process.platform === 'win32';
const hasProcFd = existsSync('/proc/self/fd');
/** Open descriptors of this process (the readdir itself adds a constant 1). */
const fdCount = () => readdirSync('/proc/self/fd').length;

let root: string; // temp root: holds the served folder, and the files a traversal would be after
let dir: string; // root/wallpapers: the served folder
let closers: Array<() => void | Promise<void>> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wp-'));
  dir = join(root, 'wallpapers');
  await mkdir(dir);
  await writeFile(join(root, 'secret.png'), SECRET); // a sibling of the folder, with an allowed extension
  await writeFile(join(root, 'settings.json'), SECRET);
});
afterEach(async () => {
  for (const c of closers.reverse()) await c();
  closers = [];
  await rm(root, { recursive: true, force: true });
});

const put = (name: string, data: string | Buffer = 'x') => writeFile(join(dir, name), data);
const urlOf = (name: string) => `/api/wallpapers/${encodeURIComponent(name)}`;

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  text: string;
}
interface Options {
  method?: string;
  headers?: Record<string, string>;
  host?: string;
}

/** A raw HTTP request: sends the path exactly as given (fetch() would normalise it) and lets the Host header be forged. */
function client(port: number) {
  return (path: string, opts: Options = {}) =>
    new Promise<Reply>((resolveReply, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', agent: false, headers: { ...(opts.host ? { Host: opts.host } : {}), ...opts.headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            resolveReply({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString('utf8') });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
}

/** The wallpaper routes on their own, mounted the way server.ts does (pathname from the WHATWG URL parser). */
async function serveDir(folder = dir) {
  const wallpapers = createWallpapers(folder);
  const server = createServer((req, res) => {
    wallpapers.handle(req, res, new URL(req.url ?? '/', 'http://localhost').pathname).catch((e) => {
      console.error('unexpected', e);
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(
    () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  );
  const port = (server.address() as AddressInfo).port;
  return Object.assign(client(port), { port });
}

/** Every refusal is the same 404, and nothing in it names a path or the secret. */
function expectNotFound(r: Reply, what: string) {
  expect(r.status, what).toBe(404);
  expect(r.text, what).toBe(NOT_FOUND);
  expect(r.headers['content-type'], what).toBe('application/json; charset=utf-8');
  const everything = r.text + JSON.stringify(r.headers);
  expect(everything, what).not.toContain(SECRET);
  expect(everything, what).not.toContain(root);
  expect(everything, what).not.toContain(tmpdir());
}

describe('wallpaperContentType / decodeWallpaperName', () => {
  it('accepts plain image names (any case of the extension)', () => {
    expect(wallpaperContentType('a.png')).toBe('image/png');
    expect(wallpaperContentType('Photo.JPG')).toBe('image/jpeg');
    expect(wallpaperContentType('x.jpeg')).toBe('image/jpeg');
    expect(wallpaperContentType('my photo.webp')).toBe('image/webp');
    expect(wallpaperContentType('x_y-z.1.avif')).toBe('image/avif');
    expect(wallpaperContentType(`${'a'.repeat(96)}.png`)).toBe('image/png'); // exactly 100 characters
  });

  it.each([
    '',
    '.png',
    '.hidden.png',
    '-a.png',
    ' a.png',
    '_a.png',
    'a..b.png',
    '..',
    '.',
    'a/b.png',
    'a\\b.png',
    'a%2fb.png',
    'a:b.png',
    'a.svg',
    'a.svgz',
    'a.html',
    'a.png.html',
    'a.png ',
    'a.png.',
    'a.gif',
    'noext',
    'png',
    'con.png',
    'NUL.png',
    'com1.jpg',
    'LPT9.webp',
    'a\u0000.png',
    'a.png\n',
    'é.png',
    'a．.png',
    'a.png.__proto__',
    '__proto__',
    `${'a'.repeat(97)}.png`, // 101 characters
  ])('refuses %j', (name) => {
    expect(wallpaperContentType(name)).toBeUndefined();
    expect(decodeWallpaperName(encodeURIComponent(name))).toBeNull();
  });

  it('decodes exactly once', () => {
    expect(decodeWallpaperName('a%20b.png')).toBe('a b.png');
    expect(decodeWallpaperName('a%2eb.png')).toBe('a.b.png'); // one decode: a legitimate name
    expect(decodeWallpaperName('a%252eb.png')).toBeNull(); // would need a second decode to become a dot
    expect(decodeWallpaperName('%252e%252e%252fsecret.png')).toBeNull();
    expect(decodeWallpaperName('..%2fsecret.png')).toBeNull();
    expect(decodeWallpaperName('%2e%2e%2fsecret.png')).toBeNull();
    expect(decodeWallpaperName('%5c..%5csecret.png')).toBeNull();
    expect(decodeWallpaperName('ok.png%00.html')).toBeNull();
    expect(decodeWallpaperName('%00ok.png')).toBeNull();
    expect(decodeWallpaperName('%C0%AE%C0%AE%2Fsecret.png')).toBeNull(); // overlong UTF-8 dots: a malformed sequence
    expect(decodeWallpaperName('%EF%BC%8E%EF%BC%8E%EF%BC%8Fsecret.png')).toBeNull(); // full-width dots and slash
    expect(decodeWallpaperName('%zz.png')).toBeNull();
    expect(decodeWallpaperName('%')).toBeNull();
  });
});

describe('GET /api/wallpapers', () => {
  it('lists only pictures, sorted by name, as { name, size }', async () => {
    await put('b.jpg', 'bbbb');
    await put('a.png', 'aa');
    await put('C.webp', 'c');
    await put('d.AVIF', 'dddd');
    await put('e.jpeg', 'eeeee');
    await put('my photo.png', 'mmm');
    // not pictures, or not names we accept:
    await put('notes.txt');
    await put('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await put('page.html', '<script>alert(1)</script>');
    await put('.hidden.png');
    await put('no-ext');
    await put('bad!.png');
    await put('a..b.png');
    await put('con.png');
    await mkdir(join(dir, 'folder.png'));
    const s = await serveDir();
    const r = await s('/api/wallpapers');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.text)).toEqual({
      files: [
        { name: 'C.webp', size: 1 },
        { name: 'a.png', size: 2 },
        { name: 'b.jpg', size: 4 },
        { name: 'd.AVIF', size: 4 },
        { name: 'e.jpeg', size: 5 },
        { name: 'my photo.png', size: 3 },
      ],
    });
  });

  it('is an empty list for an empty folder', async () => {
    const s = await serveDir();
    expect(JSON.parse((await s('/api/wallpapers')).text)).toEqual({ files: [] });
  });

  it('lists at most 100 files (after sorting); the rest can still be fetched by name', async () => {
    for (let i = 0; i < WALLPAPER_MAX_FILES + 5; i++) await put(`w${String(i).padStart(3, '0')}.png`);
    const s = await serveDir();
    const { files } = JSON.parse((await s('/api/wallpapers')).text) as { files: Array<{ name: string }> };
    expect(files).toHaveLength(WALLPAPER_MAX_FILES);
    expect(files[0]!.name).toBe('w000.png');
    expect(files.at(-1)!.name).toBe('w099.png');
    expect((await s(urlOf('w104.png'))).status).toBe(200);
  });

  it('is an empty list, and creates nothing, when the folder is missing or is not a folder', async () => {
    const missing = join(root, 'nope', 'wallpapers');
    const s = await serveDir(missing);
    const r = await s('/api/wallpapers');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ files: [] });
    expectNotFound(await s(urlOf('a.png')), 'file in a missing folder');
    expect(existsSync(join(root, 'nope'))).toBe(false);

    const notADir = await serveDir(join(root, 'secret.png'));
    expect(JSON.parse((await notADir('/api/wallpapers')).text)).toEqual({ files: [] });
  });

  it('supports HEAD and refuses other methods', async () => {
    await put('a.png');
    const s = await serveDir();
    const head = await s('/api/wallpapers', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) expectNotFound(await s('/api/wallpapers', { method }), method);
  });
});

describe('GET /api/wallpapers/:name', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('serves each type with the right headers and exactly the file bytes', async () => {
    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['b.jpg', 'image/jpeg'],
      ['c.jpeg', 'image/jpeg'],
      ['d.webp', 'image/webp'],
      ['e.avif', 'image/avif'],
      ['F.JPG', 'image/jpeg'],
      ['my photo.png', 'image/png'],
    ];
    for (const [name] of cases) await put(name, PNG);
    const s = await serveDir();
    for (const [name, type] of cases) {
      const r = await s(urlOf(name));
      expect(r.status, name).toBe(200);
      expect(r.headers['content-type'], name).toBe(type);
      expect(r.headers['content-length'], name).toBe(String(PNG.length));
      expect(r.headers['cache-control'], name).toBe('public, max-age=86400');
      expect(r.headers['x-content-type-options'], name).toBe('nosniff');
      expect(r.headers['cross-origin-resource-policy'], name).toBe('same-site');
      expect(r.headers['content-security-policy'], name).toContain("default-src 'none'");
      expect(r.headers.etag, name).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      expect(r.body.equals(PNG), name).toBe(true);
    }
  });

  it('serves an empty file and a file of exactly the size cap', async () => {
    await put('empty.png', '');
    await put('max.png', Buffer.alloc(0));
    await truncate(join(dir, 'max.png'), WALLPAPER_MAX_BYTES);
    const s = await serveDir();
    const empty = await s(urlOf('empty.png'));
    expect(empty.status).toBe(200);
    expect(empty.headers['content-length']).toBe('0');
    const max = await s(urlOf('max.png'));
    expect(max.status).toBe(200);
    expect(max.body.length).toBe(WALLPAPER_MAX_BYTES);
    const { files } = JSON.parse((await s('/api/wallpapers')).text) as { files: Array<{ name: string; size: number }> };
    expect(files.find((f) => f.name === 'max.png')?.size).toBe(WALLPAPER_MAX_BYTES);
  });

  it('answers If-None-Match with 304, and a changed file with a new ETag', async () => {
    await put('a.png', PNG);
    const s = await serveDir();
    const first = await s(urlOf('a.png'));
    const etag = first.headers.etag as string;

    for (const header of [etag, etag.replace(/^W\//, ''), `"nope", ${etag}`, '*']) {
      const hit = await s(urlOf('a.png'), { headers: { 'If-None-Match': header } });
      expect(hit.status, header).toBe(304);
      expect(hit.body.length, header).toBe(0);
      expect(hit.headers.etag, header).toBe(etag);
      expect(hit.headers['cache-control'], header).toBe('public, max-age=86400');
      expect(hit.headers['x-content-type-options'], header).toBe('nosniff');
    }
    const miss = await s(urlOf('a.png'), { headers: { 'If-None-Match': '"nope"' } });
    expect(miss.status).toBe(200);
    expect(miss.body.equals(PNG)).toBe(true);

    await put('a.png', Buffer.concat([PNG, PNG])); // replaced (bigger)
    const bigger = await s(urlOf('a.png'), { headers: { 'If-None-Match': etag } });
    expect(bigger.status).toBe(200);
    expect(bigger.headers.etag).not.toBe(etag);
    expect(bigger.body.length).toBe(PNG.length * 2);

    const sameSize = await s(urlOf('a.png'));
    await utimes(join(dir, 'a.png'), new Date(1_000_000_000_000), new Date(1_000_000_000_000)); // replaced (same size, other time)
    const touched = await s(urlOf('a.png'), { headers: { 'If-None-Match': sameSize.headers.etag as string } });
    expect(touched.status).toBe(200);
    expect(touched.headers.etag).not.toBe(sameSize.headers.etag);
  });

  it('supports HEAD (headers only) and refuses other methods', async () => {
    await put('a.png', PNG);
    const s = await serveDir();
    const get = await s(urlOf('a.png'));
    const head = await s(urlOf('a.png'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(head.headers['content-type']).toBe('image/png');
    expect(head.headers['content-length']).toBe(String(PNG.length));
    expect(head.headers.etag).toBe(get.headers.etag);
    expect((await s(urlOf('a.png'), { method: 'HEAD', headers: { 'If-None-Match': get.headers.etag as string } })).status).toBe(304);
    const missing = await s(urlOf('missing.png'), { method: 'HEAD' });
    expect(missing.status).toBe(404);
    expect(missing.body.length).toBe(0);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) expectNotFound(await s(urlOf('a.png'), { method }), method);
  });

  it('answers a missing file and a missing folder with the same 404 as every other refusal', async () => {
    const s = await serveDir();
    expectNotFound(await s(urlOf('missing.png')), 'missing file');
  });

  it('works through a symlinked wallpapers folder (data/wallpapers -> a photo library)', async () => {
    const library = join(root, 'library');
    await mkdir(library);
    await writeFile(join(library, 'real.png'), PNG);
    const link = join(root, 'link-to-library');
    await symlink(library, link);
    const s = await serveDir(link);
    expect(JSON.parse((await s('/api/wallpapers')).text)).toEqual({ files: [{ name: 'real.png', size: PNG.length }] });
    expect((await s(urlOf('real.png'))).body.equals(PNG)).toBe(true);
  });
});

describe('security: what is refused (always the same 404)', () => {
  // A file by the name each request is after exists wherever that makes the test meaningful.
  beforeEach(async () => {
    await put('ok.png', 'OK');
    await put('.hidden.png', SECRET);
    await put('a..b.png', SECRET);
    await put(`${'a'.repeat(97)}.png`, SECRET);
    await put('con.png', SECRET);
  });

  it('refuses traversal, absolute paths and encoding tricks', async () => {
    const s = await serveDir();
    expect((await s('/api/wallpapers/ok.png')).text).toBe('OK'); // the harness does serve; everything below is refused on purpose
    const absolute = encodeURIComponent(join(root, 'secret.png')); // %2Ftmp%2Fwp-...%2Fsecret.png
    const names: Array<[string, string]> = [
      ['parent', '..%2fsecret.png'],
      ['parent, upper-case escape', '..%2Fsecret.png'],
      ['encoded dots and slash', '%2e%2e%2fsecret.png'],
      ['encoded dots and slash, upper-case', '%2E%2E%2Fsecret.png'],
      ['encoded dots, literal slash', '%2e%2e/secret.png'],
      ['literal parent', '../secret.png'],
      ['literal parent, deeper', '../../secret.png'],
      ['mixed parent', '..%2f..%2f..%2f..%2fetc%2fpasswd'],
      ['backslash escape', '..%5csecret.png'],
      ['backslash escape, upper-case', '..%5Csecret.png'],
      ['literal backslash', '..\\secret.png'],
      ['leading backslash', '%5csecret.png'],
      ['windows drive', 'C%3A%5Cwindows%5Cwin.ini'],
      ['windows drive, forward slashes', 'C%3A%2Fwindows%2Fwin.ini'],
      ['double-encoded dots and slash', '%252e%252e%252fsecret.png'],
      ['double-encoded slash', '..%252fsecret.png'],
      ['double-encoded backslash', '..%255csecret.png'],
      ['double-encoded name', 'ok%252epng'],
      ['triple-encoded', '%25252e%25252e%25252fsecret.png'],
      ['absolute path', '%2Fetc%2Fpasswd'],
      ['absolute path to a real picture', absolute],
      ['absolute path, literal slashes', absolute.replace(/%2F/gi, '/')],
      ['double slash', '/etc/passwd'],
      ['empty name', ''],
      ['nul after the extension', 'ok.png%00.html'],
      ['nul at the end', 'ok.png%00'],
      ['nul at the start', '%00ok.png'],
      ['nul in a traversal', '..%00%2fsecret.png'],
      ['overlong UTF-8 dots', '%C0%AE%C0%AE%2Fsecret.png'],
      ['overlong UTF-8 slash', '..%C0%AFsecret.png'],
      ['full-width dots and slash', '%EF%BC%8E%EF%BC%8E%EF%BC%8Fsecret.png'],
      ['full-width solidus', '..%EF%BC%8Fsecret.png'],
      ['one-dot leaders', '%E2%80%A4%E2%80%A4%2Fsecret.png'],
      ['non-ASCII name', '%C3%A9.png'],
      ['non-ASCII look-alike of ok.png', 'ok%EF%BC%8Epng'],
      ['malformed escape', '%zz.png'],
      ['lone percent', '%'],
      ['truncated UTF-8', '%E0%A4%A.png'],
      ['lone surrogate', '%ED%A0%80.png'],
      ['leading dot (file exists)', '.hidden.png'],
      ['leading dot, encoded', '%2ehidden.png'],
      ['dot dot inside a name (file exists)', 'a..b.png'],
      ['only dots', '..'],
      ['one dot', '.'],
      ['trailing dot', 'ok.png.'],
      ['trailing space', 'ok.png%20'],
      ['trailing slash', 'ok.png/'],
      ['more path after the file', 'ok.png/x'],
      ['alternate data stream', 'ok.png%3Astream'],
      ['semicolon', 'ok.png;.html'],
      ['header injection', 'ok.png%0d%0aSet-Cookie:%20x=1'],
      ['name over 100 characters (file exists)', `${'a'.repeat(97)}.png`],
      ['windows device name (file exists)', 'con.png'],
    ];
    for (const [what, name] of names) expectNotFound(await s(`/api/wallpapers/${name}`), what);
    // ...and HEAD gives the same answer without a body
    for (const [what, name] of names) {
      const r = await s(`/api/wallpapers/${name}`, { method: 'HEAD' });
      expect(r.status, `HEAD ${what}`).toBe(404);
      expect(r.body.length, `HEAD ${what}`).toBe(0);
    }
  });

  it('refuses everything that is not a whitelisted image, even when the file exists (no svg, no html)', async () => {
    const bad = [
      'evil.svg',
      'evil.SVG',
      'evil.svgz',
      'page.html',
      'page.htm',
      'page.xhtml',
      'a.png.html',
      'a.png.svg',
      'a.PNG.svg',
      'a.png.exe',
      'ok.png.bak',
      'script.js',
      'style.css',
      'data.json',
      'noext',
      'a.gif',
      'a.bmp',
      'a.ico',
      'a.tiff',
      'archive.zip',
      '.png',
    ];
    for (const name of bad) await put(name, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const s = await serveDir();
    for (const name of bad) expectNotFound(await s(urlOf(name)), name);
    const { files } = JSON.parse((await s('/api/wallpapers')).text) as { files: Array<{ name: string }> };
    expect(files.map((f) => f.name)).toEqual(['ok.png']); // the only valid name in the folder
  });

  it('refuses directories, and does not list them', async () => {
    await mkdir(join(dir, 'folder.png'));
    await writeFile(join(dir, 'folder.png', 'inner.png'), SECRET);
    const s = await serveDir();
    expectNotFound(await s(urlOf('folder.png')), 'directory');
    expectNotFound(await s('/api/wallpapers/folder.png/inner.png'), 'inside a directory');
    expect(JSON.parse((await s('/api/wallpapers')).text).files.map((f: { name: string }) => f.name)).toEqual(['ok.png']);
  });

  it.skipIf(onWindows)('refuses symlinks (to a file outside, to a file inside, to a folder) and does not list them', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'photo.png'), SECRET);
    await symlink(join(root, 'secret.png'), join(dir, 'link.png')); // to a picture outside the folder
    await symlink('../secret.png', join(dir, 'relative.png')); // the same, relative
    await symlink(join(dir, 'ok.png'), join(dir, 'inside.png')); // even to a file inside the folder
    await symlink(outside, join(dir, 'dirlink.png')); // to a folder, with a name that looks like a picture
    await symlink(outside, join(dir, 'sub')); // a plain folder link
    await symlink(join(dir, 'missing.png'), join(dir, 'dangling.png'));
    await symlink('/etc/passwd', join(dir, 'passwd.png'));
    const s = await serveDir();
    for (const name of ['link.png', 'relative.png', 'inside.png', 'dirlink.png', 'dangling.png', 'passwd.png']) {
      expectNotFound(await s(urlOf(name)), name);
    }
    expectNotFound(await s('/api/wallpapers/sub%2fphoto.png'), 'through a folder link, encoded slash');
    expectNotFound(await s('/api/wallpapers/sub/photo.png'), 'through a folder link');
    expectNotFound(await s('/api/wallpapers/dirlink.png/photo.png'), 'through a folder link named like a picture');
    expect(JSON.parse((await s('/api/wallpapers')).text).files.map((f: { name: string }) => f.name)).toEqual(['ok.png']);
  });

  it.skipIf(onWindows)('refuses a FIFO without blocking, and does not list it', async () => {
    try {
      execFileSync('mkfifo', [join(dir, 'pipe.png')]);
    } catch {
      return; // no mkfifo on this machine
    }
    const s = await serveDir();
    expectNotFound(await s(urlOf('pipe.png')), 'fifo');
    expect(JSON.parse((await s('/api/wallpapers')).text).files.map((f: { name: string }) => f.name)).toEqual(['ok.png']);
  });

  it.skipIf(onWindows)('refuses a unix socket, and does not list it', async () => {
    const sock = createSocketServer();
    const listening = await new Promise<boolean>((r) => {
      sock.once('error', () => r(false));
      sock.listen(join(dir, 'sock.png'), () => r(true));
    });
    if (!listening) return; // path too long for a unix socket here
    closers.push(() => new Promise<void>((r) => void sock.close(() => r())));
    const s = await serveDir();
    expectNotFound(await s(urlOf('sock.png')), 'socket');
    expect(JSON.parse((await s('/api/wallpapers')).text).files.map((f: { name: string }) => f.name)).toEqual(['ok.png']);
  });

  it('enforces the size cap from the file size, before reading anything', async () => {
    await put('big.png', '');
    await truncate(join(dir, 'big.png'), WALLPAPER_MAX_BYTES + 1);
    const s = await serveDir();
    expectNotFound(await s(urlOf('big.png')), 'one byte over');
    expect(JSON.parse((await s('/api/wallpapers')).text).files.map((f: { name: string }) => f.name)).toEqual(['ok.png']);

    // A file this size would take ages (and gigabytes) to read: the answer must come back at once, so nothing reads it.
    await put('huge.png', '');
    try {
      await truncate(join(dir, 'huge.png'), 8 * 1024 ** 3);
    } catch {
      return; // this filesystem has no large sparse files
    }
    const started = Date.now();
    expectNotFound(await s(urlOf('huge.png')), 'sparse 8 GiB');
    const head = await s(urlOf('huge.png'), { method: 'HEAD' });
    expect(head.status).toBe(404);
    expect(head.body.length).toBe(0);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses names in any non-GET/HEAD method, and unknown routes', async () => {
    const s = await serveDir();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) expectNotFound(await s(urlOf('ok.png'), { method }), method);
    expectNotFound(await s('/api/wallpapers/'), 'trailing slash');
    expectNotFound(await s('/api/wallpapers//'), 'two slashes');
    expectNotFound(await s('/api/wallpaperz/ok.png'), 'other route');
  });

  it.skipIf(onWindows)('never serves a symlink target, even when the file is swapped for a link while requests are in flight', async () => {
    await put('race.png', 'REGULAR');
    const swap = async () => {
      for (let i = 0; i < 6; i++) {
        await symlink(join(root, 'secret.png'), join(dir, 'race.tmp'));
        await rename(join(dir, 'race.tmp'), join(dir, 'race.png')); // atomically becomes a link to the secret
        await writeFile(join(dir, 'race.tmp'), 'REGULAR');
        await rename(join(dir, 'race.tmp'), join(dir, 'race.png')); // ...and a regular file again
      }
    };
    const s = await serveDir();
    for (let round = 0; round < 60; round++) {
      const swapping = swap();
      const replies = await Promise.all(Array.from({ length: 6 }, () => s(urlOf('race.png'))));
      await swapping;
      for (const r of replies) {
        expect([200, 404]).toContain(r.status);
        expect(r.text).not.toContain(SECRET);
        if (r.status === 200) expect(r.text).toBe('REGULAR');
      }
    }
  });

  it('never answers a refusal with a server error or an error message', async () => {
    const s = await serveDir();
    for (const p of ['/api/wallpapers/%', '/api/wallpapers/%FF.png', urlOf('missing.png'), '/api/wallpapers/..%2f..%2f']) {
      const r = await s(p);
      expect(r.status, p).toBe(404);
      expect(r.text, p).not.toMatch(/ENOENT|EACCES|ELOOP|ENOTDIR|URIError|malformed|at /);
    }
  });
});

describe('serving a file: descriptors and aborts', () => {
  /** A response that never drains, like a client that has stopped reading (or a socket buffer that is full). */
  function stuckResponse() {
    const sink = new Writable({
      highWaterMark: 1,
      write() {
        /* never calls back */
      },
    });
    const meta: { status?: number } = {};
    Object.assign(sink, {
      writeHead(status: number) {
        meta.status = status;
        return sink;
      },
    });
    return { res: sink as unknown as ServerResponse, meta };
  }
  const getRequest = { method: 'GET', headers: {} } as IncomingMessage;

  it.skipIf(!hasProcFd)('closes the file as soon as the client goes away (stream destroyed)', async () => {
    await put('big.jpg', Buffer.alloc(8 * 1024 * 1024));
    const wallpapers = createWallpapers(dir);
    const before = fdCount();
    const { res, meta } = stuckResponse();
    await wallpapers.handle(getRequest, res, '/api/wallpapers/big.jpg');
    expect(meta.status).toBe(200);
    await expect.poll(fdCount, { timeout: 2000 }).toBe(before + 1); // the file is open, stuck behind a client that does not read
    res.destroy(); // the client went away
    await expect.poll(fdCount, { timeout: 2000 }).toBe(before);
  });

  it.skipIf(!hasProcFd)('survives a real client that hangs up in the middle of a download, and releases the file', async () => {
    await put('big.png', '');
    await truncate(join(dir, 'big.png'), WALLPAPER_MAX_BYTES);
    const s = await serveDir();
    await s('/api/wallpapers'); // warm up so the baseline is steady
    await new Promise((r) => setTimeout(r, 50));
    const before = fdCount();
    await new Promise<void>((resolveAbort, reject) => {
      const req = request({ host: '127.0.0.1', port: s.port, path: '/api/wallpapers/big.png', agent: false }, (res) => {
        res.on('error', () => {});
        res.once('data', () => {
          res.pause();
          req.destroy();
          resolveAbort();
        });
      });
      req.on('error', () => {});
      req.on('timeout', () => reject(new Error('no data')));
      req.end();
    });
    await expect.poll(fdCount, { timeout: 3000 }).toBe(before);
    const again = await s(urlOf('big.png'), { method: 'HEAD' });
    expect(again.status).toBe(200); // the server is still fine
  });

  it.skipIf(!hasProcFd)('does not leak descriptors on 200, 304, HEAD or any refusal', async () => {
    await put('a.png', 'AAAA');
    await put('folder.png', '');
    const s = await serveDir();
    const etag = (await s(urlOf('a.png'))).headers.etag as string;
    await new Promise((r) => setTimeout(r, 50));
    const before = fdCount();
    for (let i = 0; i < 25; i++) {
      await s(urlOf('a.png'));
      await s(urlOf('a.png'), { headers: { 'If-None-Match': etag } });
      await s(urlOf('a.png'), { method: 'HEAD' });
      await s(urlOf('a.png'), { method: 'HEAD', headers: { 'If-None-Match': etag } });
      await s(urlOf('missing.png'));
      await s('/api/wallpapers/..%2fsecret.png');
      await s('/api/wallpapers');
    }
    await expect.poll(fdCount, { timeout: 3000 }).toBe(before);
  });
});

// ---- Through the real app: routing, Host/Origin checks, config -------------------------------------------------------------------

describe('through createApp', () => {
  async function boot(wallpapersDir = dir) {
    const store = new JsonStore(root);
    const settings = new Observable(DEFAULT_SETTINGS);
    const music = createMusic({ store, settings, config });
    closers.push(() => music.dispose());
    const app = createApp({
      config: { ...config, dataDir: root, wallpapersDir },
      store,
      vehicle: createVehicleSim(),
      media: createMockMedia(),
      connections: music.connections,
      system: createSimSystem(),
      projection: createMockProjection(),
      devices: createSimDevices(),
      radio: createRadio({ store }),
      camera: createCamera(),
      settings,
      layout: new Observable(DEFAULT_LAYOUT),
    });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    closers.push(() => {
      app.server.closeAllConnections();
      app.close();
    });
    return client((app.server.address() as AddressInfo).port);
  }

  it('lists and serves the pictures in the wallpapers folder', async () => {
    await put('night.png', Buffer.from([1, 2, 3, 4]));
    await put('day.JPG', 'dd');
    await put('notes.txt');
    const s = await boot();
    expect(JSON.parse((await s('/api/wallpapers')).text)).toEqual({
      files: [
        { name: 'day.JPG', size: 2 },
        { name: 'night.png', size: 4 },
      ],
    });
    const r = await s('/api/wallpapers/night.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect([...r.body]).toEqual([1, 2, 3, 4]);
    const etag = r.headers.etag as string;
    expect((await s('/api/wallpapers/night.png', { headers: { 'If-None-Match': etag } })).status).toBe(304);
    expect((await s('/api/wallpapers/night.png', { method: 'HEAD' })).status).toBe(200);
    expectNotFound(await s('/api/wallpapers/notes.txt'), 'not a picture');
  });

  it('uses the configured folder, not the data folder', async () => {
    const pictures = join(root, 'pictures');
    await mkdir(pictures);
    await writeFile(join(pictures, 'here.png'), 'H');
    await put('there.png', 'T');
    const s = await boot(pictures);
    expect(JSON.parse((await s('/api/wallpapers')).text).files).toEqual([{ name: 'here.png', size: 1 }]);
    expectNotFound(await s('/api/wallpapers/there.png'), 'a picture in the data folder instead');
  });

  it('refuses traversal out of the folder (to files that exist in the data folder) and never falls through to the UI', async () => {
    await put('ok.png', 'OK');
    const s = await boot();
    for (const name of ['..%2fsecret.png', '..%2fsettings.json', '%2e%2e%2fsecret.png', '..%5csecret.png', '%252e%252e%252fsecret.png', '../secret.png', '%2e%2e/secret.png', '..\\secret.png', 'secret.png']) {
      const r = await s(`/api/wallpapers/${name}`);
      expectNotFound(r, name);
    }
    const missing = await s('/api/wallpapers/nothing.png');
    expect(missing.headers['content-type']).toBe('application/json; charset=utf-8'); // JSON 404, never the SPA's index.html
  });

  it('is covered by the Host check (DNS rebinding) and the Origin check on anything that is not a read', async () => {
    await put('ok.png', 'OK');
    const s = await boot();
    for (const path of ['/api/wallpapers', '/api/wallpapers/ok.png']) {
      for (const method of ['GET', 'HEAD']) {
        expect((await s(path, { method, host: 'evil.example.com' })).status, `${method} ${path} evil host`).toBe(403);
        expect((await s(path, { method, host: 'evil.example.com:8787' })).status, `${method} ${path} evil host:port`).toBe(403);
        expect((await s(path, { method, host: '127.0.0.1.evil.example.com' })).status, `${method} ${path} look-alike host`).toBe(403);
        expect((await s(path, { method, host: 'localhost:8787' })).status, `${method} ${path} localhost`).toBe(200);
      }
      expect((await s(path, { method: 'POST', headers: { Origin: 'https://evil.example.com' } })).status, `POST ${path} evil origin`).toBe(403);
      expect((await s(path, { method: 'DELETE', headers: { Origin: 'https://evil.example.com' } })).status, `DELETE ${path} evil origin`).toBe(403);
      expect((await s(path, { method: 'POST' })).status, `POST ${path}`).toBe(404);
    }
    const forged = await s('/api/wallpapers/ok.png', { host: 'evil.example.com' });
    expect(forged.text).not.toContain('OK');
  });

  it('does not create the folder when it is missing', async () => {
    const missing = join(root, 'not-yet');
    const s = await boot(missing);
    expect(JSON.parse((await s('/api/wallpapers')).text)).toEqual({ files: [] });
    expectNotFound(await s('/api/wallpapers/a.png'), 'in a missing folder');
    expect(existsSync(missing)).toBe(false);
  });
});

describe('config.wallpapersDir', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const load = async () => {
    vi.resetModules();
    return (await import('./config')).config;
  };

  it('defaults to <dataDir>/wallpapers', async () => {
    vi.stubEnv('HEADUNIT_DATA_DIR', join(root, 'data'));
    vi.stubEnv('HEADUNIT_WALLPAPER_DIR', '');
    const c = await load();
    expect(c.dataDir).toBe(resolve(root, 'data'));
    expect(c.wallpapersDir).toBe(resolve(root, 'data', 'wallpapers')); // an empty variable is "not set", not "the current folder"
  });

  it('can be moved with HEADUNIT_WALLPAPER_DIR', async () => {
    vi.stubEnv('HEADUNIT_DATA_DIR', join(root, 'data'));
    vi.stubEnv('HEADUNIT_WALLPAPER_DIR', join(root, 'photos'));
    expect((await load()).wallpapersDir).toBe(resolve(root, 'photos'));
  });
});
