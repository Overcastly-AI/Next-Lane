/**
 * Jest config for fast, DB-free unit tests of the API's authorization /
 * tenant-isolation logic. PrismaService is always mocked — these tests must
 * never touch a real database, so they can run in CI without Postgres.
 *
 * Integration tests (*.integration.spec.ts) require a real Postgres database
 * and are excluded here. Run them via:
 *   pnpm test:isolation                   (uses jest.integration.config.js)
 *   DATABASE_URL=... npx jest tenant-isolation   (target by pattern)
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  // Match all spec files EXCEPT *.integration.spec.ts — those need a real DB
  // and run via jest.integration.config.js (pnpm test:isolation).
  testRegex: '(?<!integration)\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Reuse the app tsconfig (strict mode) so tests fail the same way the
        // build does, but disable type-checking diagnostics that only matter
        // for emit to keep the runner fast.
        tsconfig: '<rootDir>/../tsconfig.json',
      },
    ],
  },
  clearMocks: true,
};
