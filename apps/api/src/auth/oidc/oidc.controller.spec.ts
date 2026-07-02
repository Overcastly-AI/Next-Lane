/**
 * Unit tests for OidcController.
 *
 * Covers the disabled-when-unconfigured contract (404, no OidcService call)
 * and the happy-path cookie/redirect wiring on `login`. `handleCallback`'s
 * business logic itself is covered by oidc.service.spec.ts — here we only
 * assert the controller wires the cookie/redirect envelope correctly.
 *
 * "Configured" is entirely delegated to `OidcService.isConfigured()` (which
 * itself reflects env vars OR an enabled in-app-admin-configured DB config —
 * see `OidcConfigService`), so these tests control it via the mocked
 * `isConfigured()` return value rather than setting env vars directly.
 */

import { NotFoundException } from '@nestjs/common';
import { OidcController } from './oidc.controller';
import type { OidcService } from './oidc.service';

function makeOidcService(): jest.Mocked<Pick<OidcService, 'resolveRedirectUri' | 'buildAuthorizationRequest' | 'handleCallback' | 'isConfigured'>> {
  return {
    resolveRedirectUri: jest.fn().mockReturnValue('https://api.example.com/api/auth/oidc/callback'),
    buildAuthorizationRequest: jest.fn(),
    handleCallback: jest.fn(),
    // Configured by default; individual tests override.
    isConfigured: jest.fn().mockResolvedValue(true),
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
  const res: {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
    redirect: jest.Mock;
  } = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  };
  return res as unknown as import('express').Response & typeof res;
}

describe('OidcController', () => {
  describe('disabled when unconfigured', () => {
    it('GET /auth/oidc/login throws 404 and never calls OidcService', async () => {
      const oidc = makeOidcService();
      oidc.isConfigured.mockResolvedValue(false);
      const controller = new OidcController(oidc as unknown as OidcService);

      await expect(controller.login(makeReq(), makeRes())).rejects.toBeInstanceOf(NotFoundException);
      expect(oidc.buildAuthorizationRequest).not.toHaveBeenCalled();
    });

    it('GET /auth/oidc/callback throws 404 and never calls OidcService', async () => {
      const oidc = makeOidcService();
      oidc.isConfigured.mockResolvedValue(false);
      const controller = new OidcController(oidc as unknown as OidcService);

      await expect(controller.callback(makeReq(), makeRes(), {})).rejects.toBeInstanceOf(NotFoundException);
      expect(oidc.handleCallback).not.toHaveBeenCalled();
    });
  });

  describe('login (configured)', () => {
    it('sets a short-lived httpOnly state cookie and redirects to the provider authorization URL', async () => {
      const oidc = makeOidcService();
      oidc.buildAuthorizationRequest.mockResolvedValue({
        url: 'https://idp.example.com/authorize?state=abc',
        stateToken: 'signed-state-token',
      });
      const controller = new OidcController(oidc as unknown as OidcService);
      const req = makeReq();
      const res = makeRes();

      await controller.login(req, res);

      expect(oidc.buildAuthorizationRequest).toHaveBeenCalledWith(
        'https://api.example.com/api/auth/oidc/callback',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'nl_oidc_state',
        'signed-state-token',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
      expect(res.redirect).toHaveBeenCalledWith('https://idp.example.com/authorize?state=abc');
    });
  });

  describe('callback (configured)', () => {
    it('clears the state cookie, redirects to the SPA sso-complete route with the token on success', async () => {
      const oidc = makeOidcService();
      oidc.handleCallback.mockResolvedValue({
        accessToken: 'jwt-abc',
        user: {
          id: 'u-1',
          email: 'a@b.com',
          name: 'A',
          avatarColor: '#fff',
          emailNotifications: true,
          isInstanceAdmin: false,
          createdAt: new Date().toISOString(),
        },
      });
      const controller = new OidcController(oidc as unknown as OidcService);
      const req = makeReq({ headers: { cookie: 'nl_oidc_state=signed-state-token' } });
      const res = makeRes();

      await controller.callback(req, res, { state: 'abc', code: 'xyz' });

      expect(res.clearCookie).toHaveBeenCalledWith('nl_oidc_state', expect.any(Object));
      expect(oidc.handleCallback).toHaveBeenCalledWith(
        { state: 'abc', code: 'xyz' },
        'signed-state-token',
        'https://api.example.com/api/auth/oidc/callback',
      );
      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login/sso-complete');
      expect(redirectUrl).toContain('token=jwt-abc');
    });

    it('redirects back to /login with a sanitised error on failure, never a raw 500 page', async () => {
      const oidc = makeOidcService();
      const { BadRequestException } = await import('@nestjs/common');
      oidc.handleCallback.mockRejectedValue(new BadRequestException('SSO state mismatch — possible CSRF attempt'));
      const controller = new OidcController(oidc as unknown as OidcService);
      const req = makeReq({ headers: {} });
      const res = makeRes();

      await controller.callback(req, res, { state: 'bad' });

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain('/login');
      expect(redirectUrl).toContain('ssoError=');
    });
  });
});
