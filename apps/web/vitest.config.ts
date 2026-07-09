import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Unit tests for pure-logic modules (optimistic cache reordering, wiki-link
// parsing, force layout, etc.). Component/flow coverage lives in the
// Playwright e2e suite; this runner is for fast, deterministic logic tests.
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
