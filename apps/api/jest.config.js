/**
 * Jest config for fast, DB-free unit tests of the API's authorization /
 * tenant-isolation logic. PrismaService is always mocked — these tests must
 * never touch a real database, so they can run in CI without Postgres.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
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
