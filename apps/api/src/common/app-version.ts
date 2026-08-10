/**
 * The running application's version, resolved once.
 *
 * Prefers `RELEASE_VERSION` (injected by CI/Helm), then falls back to
 * `package.json`. Read lazily via `require` so no import machinery is needed.
 *
 * Extracted from `health.controller.ts` because a second caller appeared and
 * the alternative was two answers to one question: the OpenAPI document had
 * its version hardcoded as `0.1.0` and had been advertising that since the
 * first week of the project, while `/health` correctly reported the real one.
 * Anyone generating a client from the spec stamped it with a version that has
 * not existed for fifteen minor releases.
 */
function resolveVersion(): string {
  if (process.env.RELEASE_VERSION) {
    return process.env.RELEASE_VERSION;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const APP_VERSION = resolveVersion();
