import { assertAuthConfig, getJwtExpiresIn, getJwtSecret } from './auth.config';

/**
 * The app must refuse to boot without a real JWT signing key (a missing/empty
 * secret would allow trivial token forgery). These tests pin that fail-fast
 * behavior so it cannot silently regress to a default.
 */
describe('auth.config', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiry = process.env.JWT_EXPIRES_IN;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalExpiry === undefined) delete process.env.JWT_EXPIRES_IN;
    else process.env.JWT_EXPIRES_IN = originalExpiry;
  });

  describe('getJwtSecret', () => {
    it('throws when JWT_SECRET is unset', () => {
      delete process.env.JWT_SECRET;
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
    });

    it('throws when JWT_SECRET is empty', () => {
      process.env.JWT_SECRET = '';
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
    });

    it('throws when JWT_SECRET is only whitespace', () => {
      process.env.JWT_SECRET = '   ';
      expect(() => getJwtSecret()).toThrow(/JWT_SECRET is not set/);
    });

    it('returns the trimmed secret when set', () => {
      process.env.JWT_SECRET = '  super-secret-key  ';
      expect(getJwtSecret()).toBe('super-secret-key');
    });
  });

  describe('assertAuthConfig', () => {
    it('throws at startup when the secret is missing', () => {
      delete process.env.JWT_SECRET;
      expect(() => assertAuthConfig()).toThrow(/JWT_SECRET is not set/);
    });

    it('does not throw when the secret is present', () => {
      process.env.JWT_SECRET = 'a-real-secret';
      expect(() => assertAuthConfig()).not.toThrow();
    });
  });

  describe('getJwtExpiresIn', () => {
    it('defaults to 7d when unset', () => {
      delete process.env.JWT_EXPIRES_IN;
      expect(getJwtExpiresIn()).toBe('7d');
    });

    it('honors an explicit value', () => {
      process.env.JWT_EXPIRES_IN = '1h';
      expect(getJwtExpiresIn()).toBe('1h');
    });
  });
});
