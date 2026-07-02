import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

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
 */
function getEncryptionKey(): Buffer {
  const raw =
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  // SHA-256 digest always yields exactly 32 bytes regardless of input length,
  // which is exactly what AES-256 needs as a key.
  return createHash('sha256').update(raw).digest();
}

const IV_BYTES = 12; // recommended IV length for AES-GCM
const ALGO = 'aes-256-gcm';

/**
 * Encrypt a raw GitHub PAT for storage. Output format: "<iv>:<authTag>:<ciphertext>"
 * (all hex-encoded) so it round-trips through a single TEXT column.
 */
export function encryptGithubToken(plainToken: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainToken, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

/**
 * Decrypt a token produced by `encryptGithubToken`. Throws if the value is
 * malformed or the auth tag does not verify (tampered/wrong key).
 */
export function decryptGithubToken(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted GitHub token');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
