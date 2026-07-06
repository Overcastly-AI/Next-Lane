/**
 * Unit tests for SsoController — the SSO/OIDC Phase 2 multi-provider runtime
 * routes. Mirrors `oidc.controller.spec.ts`'s scope: cookie/redirect wiring
 * and provider-not-found/type-mismatch dispatch. Business logic itself
 * (OIDC token exchange, SAML assertion validation, JIT provisioning) is
 * covered by `sso.service.spec.ts`/`saml.service.spec.ts`.
 */
import { NotFoundException } from '@nestjs/common';
import { SsoProviderType } from '@next-lane/shared';
import { SsoController } from './sso.controller';
import type { SsoService } from './sso.service';

function makeSsoService(): jest.Mocked<
  Pick<
    SsoService,
    | 'getEnabledProvider'
    | 'resolveCallbackUrl'
    | 'buildOidcAuthorizationRequest'
    | 'handleOidcCallback'
    | 'buildSamlLoginUrl'
    | 'handleSamlCallback'
  >
> {
  return {
    getEnabledProvider: jest.fn(),
    resolveCallbackUrl: jest.fn().mockReturnValue('https://api.example.com/api/auth/sso/okta-eng/callback'),
    buildOidcAuthorizationRequest: jest.fn(),
    handleOidcCallback: jest.fn(),
    buildSamlLoginUrl: jest.fn(),
    handleSamlCallback: jest.fn(),
  };
}

function makeReq(overrides: Partial<{ protocol: string; headers: Record<string, string> }> = {}) {
  return {
    protocol: overrides.protocol ?? 'https',
    headers: overrides.headers ?? {},
    get: (name: string) => (name === 'host' ? 'api.example.com' : undefined),
  } as unknown as import('express').Request;
}

function makeRes() {
  const res = { cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() };
  return res as unknown as import('express').Response & typeof res;
}

function oidcProvider() {
  return { type: SsoProviderType.OIDC, slug: 'okta-eng' } as never;
}

function samlProvider() {
  return { type: SsoProviderType.SAML, slug: 'corp-adfs' } as never;
}

describe('SsoController', () => {
  describe('login', () => {
    it('throws 404 for an unknown/disabled slug and never dispatches', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(null);
      const controller = new SsoController(sso as unknown as SsoService);

      await expect(controller.login(makeReq(), makeRes(), 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(sso.buildOidcAuthorizationRequest).not.toHaveBeenCalled();
      expect(sso.buildSamlLoginUrl).not.toHaveBeenCalled();
    });

    it('OIDC provider: sets a state cookie scoped to this slug and redirects to the authorization URL', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(oidcProvider());
      sso.buildOidcAuthorizationRequest.mockResolvedValue({
        url: 'https://idp.example.com/authorize?state=abc',
        stateToken: 'signed-state-token',
      });
      const controller = new SsoController(sso as unknown as SsoService);
      const res = makeRes();

      await controller.login(makeReq(), res, 'okta-eng');

      expect(res.cookie).toHaveBeenCalledWith(
        'nl_sso_oidc_state',
        'signed-state-token',
        expect.objectContaining({ httpOnly: true, path: '/api/auth/sso/okta-eng' }),
      );
      expect(res.redirect).toHaveBeenCalledWith('https://idp.example.com/authorize?state=abc');
    });

    it('SAML provider: redirects directly to the IdP with no state cookie (node-saml owns replay-window state)', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(samlProvider());
      sso.buildSamlLoginUrl.mockResolvedValue('https://adfs.example.com/sso?SAMLRequest=abc');
      const controller = new SsoController(sso as unknown as SsoService);
      const res = makeRes();

      await controller.login(makeReq(), res, 'corp-adfs');

      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('https://adfs.example.com/sso?SAMLRequest=abc');
    });
  });

  describe('oidcCallback', () => {
    it('404s when the slug resolves to a SAML provider (GET callback is OIDC-only)', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(samlProvider());
      const controller = new SsoController(sso as unknown as SsoService);

      await expect(
        controller.oidcCallback(makeReq(), makeRes(), 'corp-adfs', { state: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sso.handleOidcCallback).not.toHaveBeenCalled();
    });

    it('clears the state cookie and redirects to sso-complete with the token on success', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(oidcProvider());
      sso.handleOidcCallback.mockResolvedValue({ accessToken: 'jwt-abc', user: {} as never });
      const controller = new SsoController(sso as unknown as SsoService);
      const req = makeReq({ headers: { cookie: 'nl_sso_oidc_state=signed-state-token' } });
      const res = makeRes();

      await controller.oidcCallback(req, res, 'okta-eng', { state: 'abc', code: 'xyz' });

      expect(res.clearCookie).toHaveBeenCalledWith('nl_sso_oidc_state', expect.any(Object));
      expect(sso.handleOidcCallback).toHaveBeenCalledWith(
        oidcProvider(),
        { state: 'abc', code: 'xyz' },
        'signed-state-token',
        'https://api.example.com/api/auth/sso/okta-eng/callback',
      );
      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login/sso-complete');
      expect(redirectUrl).toContain('token=jwt-abc');
    });

    it('redirects back to /login with a sanitised error on failure', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(oidcProvider());
      const { BadRequestException } = await import('@nestjs/common');
      sso.handleOidcCallback.mockRejectedValue(new BadRequestException('SSO state mismatch'));
      const controller = new SsoController(sso as unknown as SsoService);

      await controller.oidcCallback(makeReq(), makeRes(), 'okta-eng', { state: 'bad' });

      const res = makeRes();
      await controller.oidcCallback(makeReq(), res, 'okta-eng', { state: 'bad' });
      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login');
      expect(redirectUrl).toContain('ssoError=');
    });
  });

  describe('samlCallback', () => {
    it('404s when the slug resolves to an OIDC provider (POST callback is SAML-only)', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(oidcProvider());
      const controller = new SsoController(sso as unknown as SsoService);

      await expect(
        controller.samlCallback(makeReq(), makeRes(), 'okta-eng', { SAMLResponse: 'abc' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sso.handleSamlCallback).not.toHaveBeenCalled();
    });

    it('redirects to sso-complete with the token on success', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(samlProvider());
      sso.handleSamlCallback.mockResolvedValue({ accessToken: 'jwt-saml', user: {} as never });
      const controller = new SsoController(sso as unknown as SsoService);
      const res = makeRes();

      await controller.samlCallback(makeReq(), res, 'corp-adfs', { SAMLResponse: 'base64xml', RelayState: 'corp-adfs' });

      expect(sso.handleSamlCallback).toHaveBeenCalledWith(
        samlProvider(),
        'https://api.example.com/api/auth/sso/okta-eng/callback',
        'base64xml',
      );
      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login/sso-complete');
      expect(redirectUrl).toContain('token=jwt-saml');
    });

    it('redirects back to /login with a sanitised error when the assertion is rejected', async () => {
      const sso = makeSsoService();
      sso.getEnabledProvider.mockResolvedValue(samlProvider());
      const { BadRequestException } = await import('@nestjs/common');
      sso.handleSamlCallback.mockRejectedValue(
        new BadRequestException("SSO sign-in failed — the identity provider's response could not be verified"),
      );
      const controller = new SsoController(sso as unknown as SsoService);
      const res = makeRes();

      await controller.samlCallback(makeReq(), res, 'corp-adfs', { SAMLResponse: 'forged' });

      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login');
      expect(redirectUrl).toContain('ssoError=');
    });
  });
});
