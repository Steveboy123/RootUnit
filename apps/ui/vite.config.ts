import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
const target = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(rootPackage.version ?? 'dev') },
  server: {
    port: 5173,
    strictPort: true,
    // Dev: UI on :5173, backend on :8787 — proxy so the app uses same-origin URLs like production.
    proxy: { '/api': target, '/auth': target, '/ws': { target, ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  test: { environment: 'node' },
});
