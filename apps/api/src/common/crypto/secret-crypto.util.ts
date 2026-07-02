import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Generic AES-256-GCM at-rest encryption for reversible secrets (values that
 * must later be presented in plaintext to a third party — a GitHub PAT for
 * an outbound API call, an OIDC client secret for token exchange — unlike a
 * one-way hash such as `ApiToken.tokenHash`).
 *
 * Extracted from the GitHub PAT encryption pattern
 * (`apps/api/src/github/github-crypto.util.ts`, shipped first) so every
 * secret-bearing feature shares one audited implementation instead of
 * copy-pasting AES-GCM plumbing. `github-crypto.util.ts` now delegates here;
 * its behavior/env vars are unchanged (see its own file for the
 * GITHUB_TOKEN_ENCRYPTION_KEY / JWT_SECRET fallback).
 *
 * Output format: "<iv>:<authTag>:<ciphertext>" (all hex-encoded), a single
 * TEXT column round-trip.
 */

const IV_BYTES = 12; // recommended IV length for AES-GCM
const ALGO = 'aes-256-gcm';

/**
 * Derives a 32-byte AES-256 key from an explicit env var, falling back to a
 * second env var (typically `JWT_SECRET`, already a required
 * unique-per-deployment secret) so the zero-config self-host path works
 * without asking operators to mint yet another secret. SHA-256 digest always
 * yields exactly 32 bytes regardless of input length.
 */
export function deriveEncryptionKey(
  primary: string | undefined,
  fallback: string | undefined,
): Buffer {
  const raw = primary?.trim() || fallback?.trim() || '';
  return createHash('sha256').update(raw).digest();
}

/** Encrypt a plaintext secret for storage under the given derived key. */
export function encryptSecret(plainText: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

/**
 * Decrypt a value produced by `encryptSecret`. Throws if malformed or the
 * auth tag does not verify (tampered/wrong key).
 */
export function decryptSecret(encoded: string, key: Buffer): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
