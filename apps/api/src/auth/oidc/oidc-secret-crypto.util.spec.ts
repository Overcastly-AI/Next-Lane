import { encryptOidcClientSecret, decryptOidcClientSecret } from './oidc-secret-crypto.util';

describe('oidc-secret-crypto.util', () => {
  let savedKey: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OIDC_CONFIG_ENCRYPTION_KEY;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-for-oidc-crypto-spec';
    delete process.env.OIDC_CONFIG_ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OIDC_CONFIG_ENCRYPTION_KEY;
    else process.env.OIDC_CONFIG_ENCRYPTION_KEY = savedKey;
    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;
  });

  it('round-trips a client secret (decrypt(encrypt(x)) === x)', () => {
    const raw = 'okta-client-secret-abc123';
    const encoded = encryptOidcClientSecret(raw);
    expect(decryptOidcClientSecret(encoded)).toBe(raw);
  });

  it('never stores the plaintext secret as a substring of the encoded value', () => {
    const raw = 'veryDistinctiveOidcSecret';
    const encoded = encryptOidcClientSecret(raw);
    expect(encoded).not.toContain(raw);
  });

  it('throws when decrypting after OIDC_CONFIG_ENCRYPTION_KEY changes', () => {
    const encoded = encryptOidcClientSecret('secret-value');
    process.env.OIDC_CONFIG_ENCRYPTION_KEY = 'a-completely-different-key';
    expect(() => decryptOidcClientSecret(encoded)).toThrow();
  });

  it('uses OIDC_CONFIG_ENCRYPTION_KEY when explicitly set, independent of JWT_SECRET', () => {
    process.env.OIDC_CONFIG_ENCRYPTION_KEY = 'explicit-oidc-key';
    const encoded = encryptOidcClientSecret('token-under-explicit-key');
    process.env.JWT_SECRET = 'a-totally-different-jwt-secret';
    expect(decryptOidcClientSecret(encoded)).toBe('token-under-explicit-key');
  });

  it('falls back to JWT_SECRET when OIDC_CONFIG_ENCRYPTION_KEY is unset', () => {
    const encoded = encryptOidcClientSecret('zero-config-secret');
    // Still decryptable under the same JWT_SECRET with no explicit key set.
    expect(decryptOidcClientSecret(encoded)).toBe('zero-config-secret');
  });
});
