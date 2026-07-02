import { deriveEncryptionKey, encryptSecret, decryptSecret } from './secret-crypto.util';

describe('secret-crypto.util', () => {
  describe('deriveEncryptionKey', () => {
    it('prefers the primary value when both are set', () => {
      const a = deriveEncryptionKey('primary-key', 'fallback-key');
      const b = deriveEncryptionKey('primary-key', 'different-fallback');
      expect(a.equals(b)).toBe(true);
    });

    it('falls back to the second value when the primary is unset', () => {
      const a = deriveEncryptionKey(undefined, 'fallback-key');
      const b = deriveEncryptionKey('', 'fallback-key');
      expect(a.equals(b)).toBe(true);
    });

    it('always yields a 32-byte key regardless of input length', () => {
      expect(deriveEncryptionKey('short', undefined)).toHaveLength(32);
      expect(deriveEncryptionKey('a'.repeat(500), undefined)).toHaveLength(32);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    const key = deriveEncryptionKey('test-key', undefined);

    it('round-trips (decrypt(encrypt(x)) === x)', () => {
      const encoded = encryptSecret('super-secret-value', key);
      expect(decryptSecret(encoded, key)).toBe('super-secret-value');
    });

    it('produces a different ciphertext each time (random IV)', () => {
      const a = encryptSecret('same-value', key);
      const b = encryptSecret('same-value', key);
      expect(a).not.toBe(b);
      expect(decryptSecret(a, key)).toBe('same-value');
      expect(decryptSecret(b, key)).toBe('same-value');
    });

    it('stores as "<iv>:<tag>:<ciphertext>" hex triplet', () => {
      const encoded = encryptSecret('a-value', key);
      const parts = encoded.split(':');
      expect(parts).toHaveLength(3);
      for (const part of parts) expect(part).toMatch(/^[0-9a-f]+$/);
    });

    it('never stores the plaintext as a substring of the encoded value', () => {
      const encoded = encryptSecret('veryDistinctivePlaintext', key);
      expect(encoded).not.toContain('veryDistinctivePlaintext');
    });

    it('throws when decrypting with a different key', () => {
      const encoded = encryptSecret('secret', key);
      const otherKey = deriveEncryptionKey('a-completely-different-key', undefined);
      expect(() => decryptSecret(encoded, otherKey)).toThrow();
    });

    it('throws on a malformed encoded value', () => {
      expect(() => decryptSecret('not-a-valid-triplet', key)).toThrow();
      expect(() => decryptSecret('only:two-parts', key)).toThrow();
    });
  });
});
