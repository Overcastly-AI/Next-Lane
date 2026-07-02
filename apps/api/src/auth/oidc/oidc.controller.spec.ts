/**
 * Unit tests for OidcController.
 *
 * Covers the disabled-when-unconfigured contract (404, no OidcService call)
 * and the happy-path cookie/redirect wiring on `login`. `handleCallback`'s
 * business logic itself is covered by oidc.service.spec.ts — here we only
 * assert the controller wires the cookie/redirect envelope correctly.
 */

import { NotFoundException } from '@nestjs/common';
import { OidcController } from './oidc.controller';
import type { OidcService } from './oidc.service';

function makeOidcService(): jest.Mocked<Pick<OidcService, 'resolveRedirectUri' | 'buildAuthorizationRequest' | 'handleCallback'>> {
  return {
    resolveRedirectUri: jest.fn().mockReturnValue('https://api.example.com/api/auth/oidc/callback'),
    buildAuthorizationRequest: jest.fn(),
    handleCallback: jest.fn(),
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
  const originalEnv = {
    OIDC_ISSUER_URL: process.env.OIDC_ISSUER_URL,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function setConfigured() {
    process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'client-1';
    process.env.OIDC_CLIENT_SECRET = 'shh';
  }

  function setUnconfigured() {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
  }

  describe('disabled when unconfigured', () => {
    it('GET /auth/oidc/login throws 404 and never calls OidcService', async () => {
      setUnconfigured();
      const oidc = makeOidcService();
      const controller = new OidcController(oidc as unknown as OidcService);

      await expect(controller.login(makeReq(), makeRes())).rejects.toBeInstanceOf(NotFoundException);
      expect(oidc.buildAuthorizationRequest).not.toHaveBeenCalled();
    });

    it('GET /auth/oidc/callback throws 404 and never calls OidcService', async () => {
      setUnconfigured();
      const oidc = makeOidcService();
      const controller = new OidcController(oidc as unknown as OidcService);

      await expect(controller.callback(makeReq(), makeRes(), {})).rejects.toBeInstanceOf(NotFoundException);
      expect(oidc.handleCallback).not.toHaveBeenCalled();
    });
  });

  describe('login (configured)', () => {
    it('sets a short-lived httpOnly state cookie and redirects to the provider authorization URL', async () => {
      setConfigured();
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
      setConfigured();
      const oidc = makeOidcService();
      oidc.handleCallback.mockResolvedValue({
        accessToken: 'jwt-abc',
        user: {
          id: 'u-1',
          email: 'a@b.com',
          name: 'A',
          avatarColor: '#fff',
          emailNotifications: true,
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
      setConfigured();
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
