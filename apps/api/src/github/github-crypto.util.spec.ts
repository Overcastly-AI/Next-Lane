import { encryptGithubToken, decryptGithubToken } from './github-crypto.util';

describe('github-crypto.util', () => {
  let savedKey: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-for-crypto-spec';
    delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    else process.env.GITHUB_TOKEN_ENCRYPTION_KEY = savedKey;
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
  });

  it('round-trips a token (decrypt(encrypt(x)) === x)', () => {
    const raw = 'ghp_exampleRawTokenValue1234567890';
    const encoded = encryptGithubToken(raw);
    expect(decryptGithubToken(encoded)).toBe(raw);
  });

  it('produces a different ciphertext each time (random IV) for the same input', () => {
    const raw = 'ghp_sameTokenValue';
    const a = encryptGithubToken(raw);
    const b = encryptGithubToken(raw);
    expect(a).not.toBe(b);
    expect(decryptGithubToken(a)).toBe(raw);
    expect(decryptGithubToken(b)).toBe(raw);
  });

  it('stores as "<iv>:<tag>:<ciphertext>" hex triplet', () => {
    const encoded = encryptGithubToken('a-token');
    const parts = encoded.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('never stores the plaintext token as a substring of the encoded value', () => {
    const raw = 'ghp_veryDistinctivePlaintext';
    const encoded = encryptGithubToken(raw);
    expect(encoded).not.toContain(raw);
  });

  it('throws when decrypting with a different key (GITHUB_TOKEN_ENCRYPTION_KEY changed)', () => {
    const encoded = encryptGithubToken('secret-token');
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptGithubToken(encoded)).toThrow();
  });

  it('throws on a malformed encoded value', () => {
    expect(() => decryptGithubToken('not-a-valid-triplet')).toThrow();
    expect(() => decryptGithubToken('only:two-parts')).toThrow();
  });

  it('uses GITHUB_TOKEN_ENCRYPTION_KEY when explicitly set, independent of JWT_SECRET', () => {
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'explicit-encryption-key';
    const encoded = encryptGithubToken('token-under-explicit-key');
    // Changing JWT_SECRET must not affect decryption when the explicit key is set.
    process.env.JWT_SECRET = 'a-totally-different-jwt-secret';
    expect(decryptGithubToken(encoded)).toBe('token-under-explicit-key');
  });
});
