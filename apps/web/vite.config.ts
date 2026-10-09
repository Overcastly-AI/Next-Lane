import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

/** Read a repo-root file; the Docker build context may not include it. */
function readRoot(name: string): string | null {
  const p = fileURLToPath(new URL(`../../${name}`, import.meta.url));
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/**
 * Only the newest `count` release sections — What's new shows five, and the
 * full CHANGELOG (~90 KB and growing every release) would otherwise be inlined
 * into the main bundle verbatim.
 */
function latestReleases(changelog: string, count: number): string {
  const starts = [...changelog.matchAll(/^## \[/gm)].map((m) => m.index ?? 0);
  if (starts.length <= count) return changelog;
  return changelog.slice(0, starts[count]);
}


export default defineConfig(() => {
  // Default to 5173 (the port the Docker images expose/map). An explicit
  // VITE_PORT can override it for bespoke local setups.
  const port = Number(process.env.VITE_PORT ?? 5173);
  /** Where the dev proxy forwards API traffic. Same default as the app's own. */
  const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';
  const rootPkg = readRoot('package.json');
  const appVersion = rootPkg ? (JSON.parse(rootPkg) as { version?: string }).version ?? '0.0.0' : '0.0.0';
  return {
    // Version + release notes baked in at build time (About / What's new).
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_CHANGELOG__: JSON.stringify(latestReleases(readRoot('CHANGELOG.md') ?? '', 5)),
    },
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
       *
       * `/health` IS part of the API surface even though it sits outside the
       * `/api` prefix — `main.ts` excludes it (and `/health/live`) from
       * `setGlobalPrefix` so Kubernetes probes can reach it at the root. Both
       * are published in the OpenAPI document, so Swagger's "Try it out" calls
       * them on THIS origin; without an entry here the SPA fallback answered
       * with index.html and the reference reported `200 text/html` for a route
       * that returns JSON. Anything the document publishes has to be routed.
       */
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/api-json': { target: apiTarget, changeOrigin: true },
        '/health': { target: apiTarget, changeOrigin: true },
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
