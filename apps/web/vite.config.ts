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
