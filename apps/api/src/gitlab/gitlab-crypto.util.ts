import {
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
} from '../common/crypto/secret-crypto.util';

/**
 * At-rest encryption for the GitLab PAT stored on `GitlabIntegration.tokenEncrypted`.
 *
 * Mirrors `github/github-crypto.util.ts` exactly — see that file's header
 * comment for the full rationale (recoverable, not one-way, because a future
 * `GitlabClient` outbound call needs to present the raw token to the GitLab
 * API). Both delegate to the same audited `common/crypto/secret-crypto.util.ts`
 * primitive.
 *
 * Key derivation: SHA-256 of `GITLAB_TOKEN_ENCRYPTION_KEY` when set, else
 * SHA-256 of `JWT_SECRET` (already a required, unique-per-deployment secret)
 * so the zero-config self-host path works without asking operators to mint
 * yet another secret. Self-hosters who want key separation can set
 * GITLAB_TOKEN_ENCRYPTION_KEY explicitly.
 */
function getEncryptionKey(): Buffer {
  return deriveEncryptionKey(
    process.env.GITLAB_TOKEN_ENCRYPTION_KEY,
    process.env.JWT_SECRET,
  );
}

/**
 * Encrypt a raw GitLab PAT for storage. Output format: "<iv>:<authTag>:<ciphertext>"
 * (all hex-encoded) so it round-trips through a single TEXT column.
 */
export function encryptGitlabToken(plainToken: string): string {
  return encryptSecret(plainToken, getEncryptionKey());
}

/**
 * Decrypt a token produced by `encryptGitlabToken`. Throws if the value is
 * malformed or the auth tag does not verify (tampered/wrong key).
 */
export function decryptGitlabToken(encoded: string): string {
  return decryptSecret(encoded, getEncryptionKey());
}
