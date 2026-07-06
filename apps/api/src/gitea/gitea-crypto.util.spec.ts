import { encryptGiteaToken, decryptGiteaToken } from './gitea-crypto.util';

describe('gitea-crypto.util', () => {
  let savedKey: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GITEA_TOKEN_ENCRYPTION_KEY;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-for-gitea-crypto-spec';
    delete process.env.GITEA_TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GITEA_TOKEN_ENCRYPTION_KEY;
    else process.env.GITEA_TOKEN_ENCRYPTION_KEY = savedKey;
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
  });

  it('round-trips a token (decrypt(encrypt(x)) === x)', () => {
    const raw = 'gitea-exampleRawTokenValue1234567890';
    const encoded = encryptGiteaToken(raw);
    expect(decryptGiteaToken(encoded)).toBe(raw);
  });

  it('produces a different ciphertext each time (random IV) for the same input', () => {
    const raw = 'gitea-sameTokenValue';
    const a = encryptGiteaToken(raw);
    const b = encryptGiteaToken(raw);
    expect(a).not.toBe(b);
    expect(decryptGiteaToken(a)).toBe(raw);
    expect(decryptGiteaToken(b)).toBe(raw);
  });

  it('stores as "<iv>:<tag>:<ciphertext>" hex triplet', () => {
    const encoded = encryptGiteaToken('a-token');
    const parts = encoded.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('never stores the plaintext token as a substring of the encoded value', () => {
    const raw = 'gitea-veryDistinctivePlaintext';
    const encoded = encryptGiteaToken(raw);
    expect(encoded).not.toContain(raw);
  });

  it('throws when decrypting with a different key (GITEA_TOKEN_ENCRYPTION_KEY changed)', () => {
    const encoded = encryptGiteaToken('secret-token');
    process.env.GITEA_TOKEN_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptGiteaToken(encoded)).toThrow();
  });

  it('throws on a malformed encoded value', () => {
    expect(() => decryptGiteaToken('not-a-valid-triplet')).toThrow();
    expect(() => decryptGiteaToken('only:two-parts')).toThrow();
  });

  it('uses GITEA_TOKEN_ENCRYPTION_KEY when explicitly set, independent of JWT_SECRET', () => {
    process.env.GITEA_TOKEN_ENCRYPTION_KEY = 'explicit-encryption-key';
    const encoded = encryptGiteaToken('token-under-explicit-key');
    // Changing JWT_SECRET must not affect decryption when the explicit key is set.
    process.env.JWT_SECRET = 'a-totally-different-jwt-secret';
    expect(decryptGiteaToken(encoded)).toBe('token-under-explicit-key');
  });

  it('is independent of the GitHub/GitLab token encryption keys (different env var, same fallback)', () => {
    // All three fall back to JWT_SECRET when unset, but each has its own
    // explicit override knob — setting one must not affect the others.
    process.env.GITEA_TOKEN_ENCRYPTION_KEY = 'gitea-only-key';
    const encoded = encryptGiteaToken('token-under-gitea-key');
    delete process.env.GITEA_TOKEN_ENCRYPTION_KEY;
    expect(() => decryptGiteaToken(encoded)).toThrow();
  });
});
