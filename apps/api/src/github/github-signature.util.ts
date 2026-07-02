import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the `sha256=<hmac>` value GitHub sends in the `X-Hub-Signature-256`
 * header for a given webhook secret and raw request body.
 *
 * IMPORTANT: `rawBody` must be the exact bytes GitHub signed (before any JSON
 * re-serialization) — see main.ts `rawBody: true` + the controller's use of
 * `req.rawBody`.
 */
export function computeGithubSignature(
  secret: string,
  rawBody: Buffer | string,
): string {
  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Verify a `X-Hub-Signature-256` header value against the raw body using a
 * constant-time comparison (timing-safe). Returns false (never throws) for a
 * missing header, malformed header, or mismatch — the caller rejects with 401
 * in all of those cases.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer | string,
  headerValue: string | undefined | null,
): boolean {
  if (!headerValue) return false;
  const expected = computeGithubSignature(secret, rawBody);
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(headerValue);
  // timingSafeEqual throws if buffer lengths differ — guard first.
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}
