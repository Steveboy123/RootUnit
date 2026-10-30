import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'vendor/spotify-connect');
const out = resolve(outDir, 'librespot');
const source = 'https://dtcooper.github.io/raspotify/raspotify-latest_arm64.deb';

if (process.env.HEADUNIT_SKIP_SPOTIFY_CONNECT === '1') {
  console.log('[spotify-connect] skipped by HEADUNIT_SKIP_SPOTIFY_CONNECT=1');
  process.exit(0);
}
if (process.platform !== 'linux' || process.arch !== 'arm64') {
  console.log(`[spotify-connect] not vendoring receiver on ${process.platform}/${process.arch}`);
  process.exit(0);
}
try {
  const s = await stat(out);
  if (s.isFile() && s.size > 1_000_000) {
    console.log('[spotify-connect] receiver already present');
    process.exit(0);
  }
} catch {}

console.log('[spotify-connect] downloading Raspberry Pi Spotify Connect receiver…');
const work = await mkdtemp(join(tmpdir(), 'headunit-librespot-'));
try {
  const deb = join(work, 'raspotify.deb');
  const response = await fetch(source, { signal: AbortSignal.timeout(90_000), redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 100 * 1024 * 1024) throw new Error('download is unexpectedly large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000 || bytes.length > 100 * 1024 * 1024) throw new Error('download size is invalid');
  if (bytes.subarray(0, 8).toString('ascii') !== '!<arch>\n') throw new Error('download is not a Debian package');
  await writeFile(deb, bytes, { mode: 0o600 });

  const extracted = join(work, 'x');
  await mkdir(extracted);
  await exec('dpkg-deb', ['-x', deb, extracted], { timeout: 60_000 });
  const binary = join(extracted, 'usr/bin/librespot');
  const bs = await stat(binary);
  if (!bs.isFile() || bs.size < 1_000_000) throw new Error('package did not contain the expected librespot binary');

  await mkdir(outDir, { recursive: true });
  await copyFile(binary, out);
  await chmod(out, 0o755);

  // Keep the package's copyright/license notice beside the binary when available.
  for (const candidate of [
    join(extracted, 'usr/share/doc/raspotify/copyright'),
    join(extracted, 'usr/share/doc/librespot/copyright'),
  ]) {
    try {
      await copyFile(candidate, join(outDir, 'COPYRIGHT'));
      break;
    } catch {}
  }
  await writeFile(
    join(outDir, 'SOURCE.txt'),
    `Downloaded at build time from the Raspotify arm64 package:\n${source}\n\nThe head-unit ZIP does not bundle this binary; Pi builds fetch it from the upstream project.\n`,
  );
  console.log(`[spotify-connect] installed receiver: ${out}`);
} catch (e) {
  console.error(`[spotify-connect] ${e instanceof Error ? e.message : String(e)}`);
  console.error('[spotify-connect] The Pi must be online during this update/build. Set HEADUNIT_SKIP_SPOTIFY_CONNECT=1 only if you intentionally do not want Spotify playback on the Pi.');
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
