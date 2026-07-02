import {
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
} from '../common/crypto/secret-crypto.util';

/**
 * At-rest encryption for the GitHub PAT stored on `GithubIntegration.tokenEncrypted`.
 *
 * Unlike `ApiToken.tokenHash` (SHA-256, one-way — fine because a PAT is only
 * ever *compared*, never re-presented), the GitHub token must be recoverable:
 * a future `GithubClient` outbound call (e.g. polling PR/CI status) needs to
 * send the raw token to the GitHub API. AES-256-GCM gives us at-rest
 * confidentiality + tamper detection while remaining reversible.
 *
 * Key derivation: SHA-256 of `GITHUB_TOKEN_ENCRYPTION_KEY` when set, else
 * SHA-256 of `JWT_SECRET` (already a required, unique-per-deployment secret —
 * see auth.config.ts) so the zero-config self-host path works without asking
 * operators to mint yet another secret. Self-hosters who want key separation
 * (e.g. so rotating JWT_SECRET doesn't invalidate stored GitHub tokens) can
 * set GITHUB_TOKEN_ENCRYPTION_KEY explicitly.
 *
 * The actual AES-256-GCM implementation lives in the shared
 * `common/crypto/secret-crypto.util.ts` helper (extracted so the OIDC
 * client-secret encryption — `auth/oidc/oidc-secret-crypto.util.ts` — reuses
 * the exact same audited primitive instead of a second copy); this file's
 * public behavior/env vars are unchanged.
 */
function getEncryptionKey(): Buffer {
  return deriveEncryptionKey(
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY,
    process.env.JWT_SECRET,
  );
}

/**
 * Encrypt a raw GitHub PAT for storage. Output format: "<iv>:<authTag>:<ciphertext>"
 * (all hex-encoded) so it round-trips through a single TEXT column.
 */
export function encryptGithubToken(plainToken: string): string {
  return encryptSecret(plainToken, getEncryptionKey());
}

/**
 * Decrypt a token produced by `encryptGithubToken`. Throws if the value is
 * malformed or the auth tag does not verify (tampered/wrong key).
 */
export function decryptGithubToken(encoded: string): string {
  return decryptSecret(encoded, getEncryptionKey());
}
