import { timingSafeEqual } from 'node:crypto';

/**
 * Verify the `X-Gitlab-Token` header GitLab sends on every webhook delivery.
 *
 * Unlike GitHub (which HMAC-signs the raw body with `X-Hub-Signature-256`),
 * GitLab does not sign the payload at all — it sends the literal shared
 * secret back verbatim in this header on every request
 * (https://docs.gitlab.com/ee/user/project/integrations/webhooks.html#validate-payloads-by-using-a-secret-token).
 * So "verification" here is a plain equality check against the stored
 * `webhookSecret`, done in constant time (`timingSafeEqual`) so a byte-by-byte
 * timing side-channel can't be used to guess the secret one character at a
 * time. Returns false (never throws) for a missing header, empty header, or
 * mismatch — the caller rejects with 401 in all of those cases, mirroring
 * `verifyGithubSignature`'s contract exactly.
 */
export function verifyGitlabToken(
  secret: string,
  headerValue: string | undefined | null,
): boolean {
  if (!headerValue) return false;
  const secretBuf = Buffer.from(secret);
  const givenBuf = Buffer.from(headerValue);
  // timingSafeEqual throws if buffer lengths differ — guard first. (Length
  // itself leaks 1 bit of information over a timing side channel, same as
  // GitHub's HMAC-compare guard; the secret is long/random enough that this
  // is not exploitable.)
  if (secretBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(secretBuf, givenBuf);
}
