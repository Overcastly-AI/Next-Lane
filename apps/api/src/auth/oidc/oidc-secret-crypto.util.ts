import {
  deriveEncryptionKey,
  encryptSecret,
  decryptSecret,
} from '../../common/crypto/secret-crypto.util';

/**
 * At-rest encryption for the OIDC client secret stored on
 * `OidcConfig.clientSecretEncrypted` (the in-app SSO admin settings screen).
 * Mirrors `github-crypto.util.ts` exactly — same AES-256-GCM primitive (via
 * the shared `common/crypto/secret-crypto.util.ts` helper), same
 * fallback-to-`JWT_SECRET` zero-config story, reversible because the OIDC
 * client library needs the raw secret for the token-exchange request.
 *
 * Key derivation: SHA-256 of `OIDC_CONFIG_ENCRYPTION_KEY` when set, else
 * SHA-256 of `JWT_SECRET`. Self-hosters who want key separation from JWT
 * signing (or from the GitHub PAT key) can set `OIDC_CONFIG_ENCRYPTION_KEY`
 * explicitly.
 */
function getEncryptionKey(): Buffer {
  return deriveEncryptionKey(
    process.env.OIDC_CONFIG_ENCRYPTION_KEY,
    process.env.JWT_SECRET,
  );
}

/** Encrypt a raw OIDC client secret for storage. Format: "<iv>:<authTag>:<ciphertext>" hex triplet. */
export function encryptOidcClientSecret(plainSecret: string): string {
  return encryptSecret(plainSecret, getEncryptionKey());
}

/** Decrypt a value produced by `encryptOidcClientSecret`. Throws on malformed input or a wrong/rotated key. */
export function decryptOidcClientSecret(encoded: string): string {
  return decryptSecret(encoded, getEncryptionKey());
}
