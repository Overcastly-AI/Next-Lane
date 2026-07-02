/**
 * Unit tests for AuthController.
 *
 * Scope: the public `GET /auth/providers` capability probe added for
 * SSO/OIDC Phase 1 (the frontend uses this to decide whether to render the
 * "Continue with SSO" button — never assume a provider is configured). The
 * rest of AuthController delegates directly to AuthService/PasswordResetService
 * and is exercised indirectly through their own unit tests.
 */

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PasswordResetService } from './password-reset.service';

function makeController(): AuthController {
  return new AuthController(
    {} as unknown as AuthService,
    {} as unknown as PrismaService,
    {} as unknown as PasswordResetService,
  );
}

describe('AuthController — GET /auth/providers', () => {
  const originalEnv = {
    OIDC_ISSUER_URL: process.env.OIDC_ISSUER_URL,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_BUTTON_LABEL: process.env.OIDC_BUTTON_LABEL,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('reports oidc.enabled: false and the default label when unconfigured', () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_BUTTON_LABEL;

    const controller = makeController();
    expect(controller.providers()).toEqual({
      oidc: { enabled: false, label: 'Single sign-on' },
    });
  });

  it('reports oidc.enabled: true and a custom label when fully configured', () => {
    process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
    process.env.OIDC_CLIENT_ID = 'client-1';
    process.env.OIDC_CLIENT_SECRET = 'shh';
    process.env.OIDC_BUTTON_LABEL = 'Continue with Okta';

    const controller = makeController();
    expect(controller.providers()).toEqual({
      oidc: { enabled: true, label: 'Continue with Okta' },
    });
  });

  it('stays disabled when only some OIDC vars are set (no partial-config foot-gun)', () => {
    process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;

    const controller = makeController();
    expect(controller.providers().oidc.enabled).toBe(false);
  });
});
