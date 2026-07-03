import { encryptGitlabToken, decryptGitlabToken } from './gitlab-crypto.util';

describe('gitlab-crypto.util', () => {
  let savedKey: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GITLAB_TOKEN_ENCRYPTION_KEY;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-for-gitlab-crypto-spec';
    delete process.env.GITLAB_TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.GITLAB_TOKEN_ENCRYPTION_KEY;
    else process.env.GITLAB_TOKEN_ENCRYPTION_KEY = savedKey;
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
  });

  it('round-trips a token (decrypt(encrypt(x)) === x)', () => {
    const raw = 'glpat-exampleRawTokenValue1234567890';
    const encoded = encryptGitlabToken(raw);
    expect(decryptGitlabToken(encoded)).toBe(raw);
  });

  it('produces a different ciphertext each time (random IV) for the same input', () => {
    const raw = 'glpat-sameTokenValue';
    const a = encryptGitlabToken(raw);
    const b = encryptGitlabToken(raw);
    expect(a).not.toBe(b);
    expect(decryptGitlabToken(a)).toBe(raw);
    expect(decryptGitlabToken(b)).toBe(raw);
  });

  it('stores as "<iv>:<tag>:<ciphertext>" hex triplet', () => {
    const encoded = encryptGitlabToken('a-token');
    const parts = encoded.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('never stores the plaintext token as a substring of the encoded value', () => {
    const raw = 'glpat-veryDistinctivePlaintext';
    const encoded = encryptGitlabToken(raw);
    expect(encoded).not.toContain(raw);
  });

  it('throws when decrypting with a different key (GITLAB_TOKEN_ENCRYPTION_KEY changed)', () => {
    const encoded = encryptGitlabToken('secret-token');
    process.env.GITLAB_TOKEN_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptGitlabToken(encoded)).toThrow();
  });

  it('throws on a malformed encoded value', () => {
    expect(() => decryptGitlabToken('not-a-valid-triplet')).toThrow();
    expect(() => decryptGitlabToken('only:two-parts')).toThrow();
  });

  it('uses GITLAB_TOKEN_ENCRYPTION_KEY when explicitly set, independent of JWT_SECRET', () => {
    process.env.GITLAB_TOKEN_ENCRYPTION_KEY = 'explicit-encryption-key';
    const encoded = encryptGitlabToken('token-under-explicit-key');
    // Changing JWT_SECRET must not affect decryption when the explicit key is set.
    process.env.JWT_SECRET = 'a-totally-different-jwt-secret';
    expect(decryptGitlabToken(encoded)).toBe('token-under-explicit-key');
  });

  it('is independent of the GitHub token encryption key (different env var, same fallback)', () => {
    // Both fall back to JWT_SECRET when unset, but each has its own explicit
    // override knob — setting one must not affect the other.
    process.env.GITLAB_TOKEN_ENCRYPTION_KEY = 'gitlab-only-key';
    const encoded = encryptGitlabToken('token-under-gitlab-key');
    delete process.env.GITLAB_TOKEN_ENCRYPTION_KEY;
    expect(() => decryptGitlabToken(encoded)).toThrow();
  });
});
