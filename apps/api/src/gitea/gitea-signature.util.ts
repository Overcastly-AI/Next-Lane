import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the value Gitea sends in the `X-Gitea-Signature` header for a
 * given webhook secret and raw request body: a plain hex-encoded
 * HMAC-SHA256 digest.
 *
 * IMPORTANT, and the one real difference from GitHub's `X-Hub-Signature-256`
 * (`github-signature.util.ts`): Gitea does NOT prefix the value with
 * "sha256=" — the header is the bare hex digest
 * (https://docs.gitea.com/usage/webhooks — "the HMAC hex digest of the
 * request body"). `rawBody` must be the exact bytes Gitea signed (before any
 * JSON re-serialization) — see main.ts `rawBody: true` (already enabled
 * globally for the GitHub webhook receiver; reused here unchanged) + the
 * controller's use of `req.rawBody`.
 */
export function computeGiteaSignature(
  secret: string,
  rawBody: Buffer | string,
): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verify a `X-Gitea-Signature` header value against the raw body using a
 * constant-time comparison (timing-safe). Returns false (never throws) for a
 * missing header, malformed header, or mismatch — the caller rejects with
 * 401 in all of those cases. Mirrors `verifyGithubSignature`'s contract
 * exactly, minus the "sha256=" prefix Gitea doesn't send.
 */
export function verifyGiteaSignature(
  secret: string,
  rawBody: Buffer | string,
  headerValue: string | undefined | null,
): boolean {
  if (!headerValue) return false;
  const expected = computeGiteaSignature(secret, rawBody);
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(headerValue);
  // timingSafeEqual throws if buffer lengths differ — guard first.
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}
