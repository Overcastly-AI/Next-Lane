import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  // Default to 5173 (the port the Docker images expose/map). An explicit
  // VITE_PORT can override it for bespoke local setups.
  const port = Number(process.env.VITE_PORT ?? 5173);
  /** Where the dev proxy forwards API traffic. Same default as the app's own. */
  const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';
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
      /*
       * Mirror production's shape in dev.
       *
       * The built web image reverse-proxies the API onto its own origin (see
       * apps/web/docker-entrypoint.sh), so `/api`, `/api-json` and the socket
       * all answer on the app's port. Without this, `pnpm dev` is the ONE
       * deployment where they do not — which is how the same-origin path ends
       * up only ever being exercised in CI, and why the in-app API reference
       * could look broken locally and fine in production.
       *
       * Only used when the app is asked for a same-origin path; setting
       * VITE_API_URL to an absolute origin bypasses this entirely.
       */
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/api-json': { target: apiTarget, changeOrigin: true },
        '/socket.io': { target: apiTarget, changeOrigin: true, ws: true },
      },
    },
    build: {
      modulePreload: {
        // DEFENSIVE, not a bug fix. An earlier version of this comment
        // claimed the polyfill was injecting a CSP-blocked inline <script>
        // into the built index.html. That was wrong: the only "inline
        // script" in the built HTML was the literal text `<script>` inside
        // an HTML comment, and scripts/smoke-web-csp.sh was scanning raw
        // HTML without stripping comments. Verified on the real artifact —
        // with the polyfill ENABLED the build emits no inline script and no
        // `<link rel="modulepreload">` at all, so the polyfill is inert
        // here and ships as dead code in the entry chunk.
        //
        // Kept off anyway, because Vite injects that polyfill INLINE at the
        // point it becomes necessary. Today nothing emits modulepreload
        // links; the day code-splitting changes that, `polyfill: true` would
        // start writing an inline script into index.html and break the
        // strict `script-src 'self'` the production nginx serves. Disabling
        // it now costs only preload hints on browsers that lack native
        // modulepreload — every browser that can run this ES-module bundle
        // still loads all chunks.
        polyfill: false,
      },
    },
  };
});
