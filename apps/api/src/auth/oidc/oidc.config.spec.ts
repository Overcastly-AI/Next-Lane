import {
  getOidcButtonLabel,
  getOidcEnvConfig,
  getOidcRedirectUriOverride,
  isOidcConfigured,
} from './oidc.config';

/**
 * SSO/OIDC is fully env-driven and OFF unless all three required variables
 * (issuer, client id, client secret) are set — the zero-config self-host path
 * must be unaffected by this feature's existence.
 */
describe('oidc.config', () => {
  const keys = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_BUTTON_LABEL', 'OIDC_REDIRECT_URI'];
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      originals[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (originals[k] === undefined) delete process.env[k];
      else process.env[k] = originals[k];
    }
  });

  describe('isOidcConfigured / getOidcEnvConfig', () => {
    it('is disabled when no OIDC vars are set', () => {
      expect(isOidcConfigured()).toBe(false);
      expect(getOidcEnvConfig()).toBeNull();
    });

    it('is disabled when only some vars are set', () => {
      process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
      process.env.OIDC_CLIENT_ID = 'client-1';
      // OIDC_CLIENT_SECRET intentionally left unset
      expect(isOidcConfigured()).toBe(false);
      expect(getOidcEnvConfig()).toBeNull();
    });

    it('is disabled when a required var is only whitespace', () => {
      process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
      process.env.OIDC_CLIENT_ID = 'client-1';
      process.env.OIDC_CLIENT_SECRET = '   ';
      expect(isOidcConfigured()).toBe(false);
    });

    it('is enabled when all three required vars are set', () => {
      process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
      process.env.OIDC_CLIENT_ID = 'client-1';
      process.env.OIDC_CLIENT_SECRET = 'super-secret';
      expect(isOidcConfigured()).toBe(true);
      expect(getOidcEnvConfig()).toEqual({
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'super-secret',
      });
    });

    it('trims surrounding whitespace from configured values', () => {
      process.env.OIDC_ISSUER_URL = '  https://idp.example.com  ';
      process.env.OIDC_CLIENT_ID = '  client-1  ';
      process.env.OIDC_CLIENT_SECRET = '  super-secret  ';
      expect(getOidcEnvConfig()).toEqual({
        issuerUrl: 'https://idp.example.com',
        clientId: 'client-1',
        clientSecret: 'super-secret',
      });
    });
  });

  describe('getOidcButtonLabel', () => {
    it('defaults to "Single sign-on"', () => {
      expect(getOidcButtonLabel()).toBe('Single sign-on');
    });

    it('honors an explicit OIDC_BUTTON_LABEL', () => {
      process.env.OIDC_BUTTON_LABEL = 'Continue with Okta';
      expect(getOidcButtonLabel()).toBe('Continue with Okta');
    });

    it('falls back to the default when OIDC_BUTTON_LABEL is only whitespace', () => {
      process.env.OIDC_BUTTON_LABEL = '   ';
      expect(getOidcButtonLabel()).toBe('Single sign-on');
    });
  });

  describe('getOidcRedirectUriOverride', () => {
    it('is undefined when unset', () => {
      expect(getOidcRedirectUriOverride()).toBeUndefined();
    });

    it('returns the configured absolute URL', () => {
      process.env.OIDC_REDIRECT_URI = 'https://tracker.example.com/api/auth/oidc/callback';
      expect(getOidcRedirectUriOverride()).toBe('https://tracker.example.com/api/auth/oidc/callback');
    });
  });
});
