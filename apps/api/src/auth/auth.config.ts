/**
 * Centralized auth configuration.
 *
 * JWT_SECRET is REQUIRED — there is intentionally no default. Booting with a
 * hardcoded/known signing key would allow trivial token forgery, so the app
 * must refuse to start without a real secret (see assertAuthConfig, called
 * during bootstrap before the server listens).
 */

const JWT_EXPIRES_IN_DEFAULT = '7d';

/** Throws if JWT_SECRET is missing or empty. Call once at startup (fail fast). */
export function assertAuthConfig(): void {
  getJwtSecret();
}

/** Returns the configured JWT secret, throwing if it is missing or empty. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Set a strong, unique JWT_SECRET in the environment; ' +
        'the application will not start without it.',
    );
  }
  return secret;
}

/** Returns the configured JWT expiry, defaulting to 7d. */
export function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? JWT_EXPIRES_IN_DEFAULT;
}
