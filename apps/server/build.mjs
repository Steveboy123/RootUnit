import { build } from 'esbuild';

// Bundle the server (and the shared workspace package) into one file; `ws` stays a runtime dependency.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['ws', 'serialport'],
  sourcemap: true,
  logLevel: 'info',
});
