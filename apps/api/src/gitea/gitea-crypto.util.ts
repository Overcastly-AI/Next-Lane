import {
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
} from '../common/crypto/secret-crypto.util';

/**
 * At-rest encryption for the Gitea access token stored on
 * `GiteaIntegration.tokenEncrypted`. Mirrors `github-crypto.util.ts` /
 * `gitlab-crypto.util.ts` exactly — AES-256-GCM (reversible, unlike the
 * one-way `ApiToken.tokenHash`) via the shared
 * `common/crypto/secret-crypto.util.ts` primitive.
 *
 * Key derivation: SHA-256 of `GITEA_TOKEN_ENCRYPTION_KEY` when set, else
 * SHA-256 of `JWT_SECRET` (zero-config self-host path, same fallback pattern
 * as GitHub/GitLab). Self-hosters wanting key separation can set
 * `GITEA_TOKEN_ENCRYPTION_KEY` explicitly.
 */
function getEncryptionKey(): Buffer {
  return deriveEncryptionKey(
    process.env.GITEA_TOKEN_ENCRYPTION_KEY,
    process.env.JWT_SECRET,
  );
}

/**
 * Encrypt a raw Gitea token for storage. Output format:
 * "<iv>:<authTag>:<ciphertext>" (all hex-encoded).
 */
export function encryptGiteaToken(plainToken: string): string {
  return encryptSecret(plainToken, getEncryptionKey());
}

/**
 * Decrypt a token produced by `encryptGiteaToken`. Throws if the value is
 * malformed or the auth tag does not verify (tampered/wrong key).
 */
export function decryptGiteaToken(encoded: string): string {
  return decryptSecret(encoded, getEncryptionKey());
}
