import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  // Default to 5173 (the port the Docker images expose/map). An explicit
  // VITE_PORT can override it for bespoke local setups.
  const port = Number(process.env.VITE_PORT ?? 5173);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@next-lane/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port,
      host: true,
    },
    build: {
      modulePreload: {
        // Vite's default (`polyfill: true`) injects an INLINE <script> into
        // the built index.html. The production nginx serves a strict
        // `script-src 'self'` with no 'unsafe-inline'/nonce/hash, so the
        // browser silently blocks it — caught by mode 3 of
        // scripts/smoke-web-csp.sh against the real image:
        //
        //   inline <script> tag found: <script>
        //   SMOKE FAIL: [mode 3] served index.html contains an inline
        //   <script> ... will be SILENTLY BLOCKED by the browser
        //
        // The source index.html is deliberately inline-script-free (the
        // theme bootstrap was moved to the self-hosted /theme-init.js for
        // exactly this reason) — the polyfill was the only thing putting one
        // back, at build time, where nobody could see it.
        //
        // Turning it off is safe here: it only backfills
        // `<link rel="modulepreload">` for older browsers. Anything that
        // supports the ES-module bundle this app ships still loads every
        // chunk correctly — it just doesn't get preload hints. That is a
        // marginal, browser-specific latency trade; a CSP-blocked script is
        // a correctness bug.
        polyfill: false,
      },
    },
  };
});
