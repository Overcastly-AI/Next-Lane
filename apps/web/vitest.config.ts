import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Unit tests for pure-logic modules (optimistic cache reordering, wiki-link
// parsing, force layout, etc.). Component/flow coverage lives in the
// Playwright e2e suite; this runner is for fast, deterministic logic tests.
//
// A FEW FILES OPT INTO jsdom via `// @vitest-environment jsdom` (the DOMPurify
// sanitizer tests need a real DOM). `dangerouslyIgnoreUnhandledErrors` stays
// OFF deliberately: when jsdom failed to load on CI's Node 20 — jsdom 30 pulls
// undici 8, which calls a `node:worker_threads` API that Node 20 doesn't have —
// vitest reported it as an unhandled error and FAILED the run. Without that,
// those files would simply not have run and the suite would have gone green
// having silently dropped 13 tests. jsdom is pinned to ^26 for that reason;
// `src/dom-environment.test.ts` is the second guard.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@next-lane/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Playwright specs live under e2e/ and must never be picked up by vitest.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
