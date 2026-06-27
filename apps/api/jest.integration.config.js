/**
 * Jest config for the tenant isolation integration test.
 *
 * Unlike the main jest.config.js (which is DB-free unit tests), this config
 * runs ONLY the integration spec that needs a real Postgres database.
 *
 * Usage (from apps/api):
 *   DATABASE_URL=<url> JWT_SECRET=<secret> npx jest --config jest.integration.config.js
 *
 * Or via the npm script:
 *   DATABASE_URL=<url> JWT_SECRET=<secret> pnpm test:isolation
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Extend the default timeout to 120 s — the integration suite boots a full
  // NestJS app + real DB and runs 40+ HTTP requests sequentially.
  testTimeout: 120_000,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../tsconfig.json',
      },
    ],
  },
  // Run serially (no worker isolation needed; the tests share one NestJS app).
  maxWorkers: 1,
  clearMocks: true,
  // The harness opens a socket.io-client + a Nest app whose handles can keep the
  // process alive after specs pass; force exit so the run terminates cleanly
  // instead of hanging on lingering handles.
  forceExit: true,
};
