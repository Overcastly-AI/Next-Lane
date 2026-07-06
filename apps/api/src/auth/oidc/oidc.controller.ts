/**
 * OidcController — SSO/OIDC Phase 1 login/callback endpoints.
 *
 * Both routes are full-page browser navigations (the frontend renders a plain
 * `<a href="/api/auth/oidc/login">` link, not a fetch call), so state is
 * carried via a short-lived, httpOnly, signed-JWT cookie rather than a
 * request body — the browser round-trips it to the identity provider and
 * back automatically.
 *
 * When OIDC is not configured (`OidcService.isConfigured()` false — env vars
 * unset AND no enabled DB config saved from the admin settings screen) both
 * routes respond 404 — the feature is fully absent, not just hidden, for
 * self-hosters who never set it up.
 *
 * Not `@RequireScope`-gated: both routes are `@Public()` browser navigations
 * with no bearer token at all — there is no PAT/JWT principal for
 * `ScopeGuard` to check a scope against.
 */

import { BadRequestException, Controller, Get, NotFoundException, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../public.decorator';
import { OidcService } from './oidc.service';

/** Name of the short-lived cookie carrying the signed state/nonce/PKCE-verifier token. */
const STATE_COOKIE = 'nl_oidc_state';
/** Matches the state token's own JWT expiry (buildAuthorizationRequest signs with 10m). */
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? process.env.RESET_BASE_URL ?? 'http://localhost:3000';
}

/** Best-effort manual cookie read — no cookie-parser dependency needed for a single cookie. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

@ApiExcludeController()
@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  @Public()
  @Get('login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!(await this.oidc.isConfigured())) {
      throw new NotFoundException('SSO is not configured on this server');
    }

    const redirectUri = this.oidc.resolveRedirectUri(req);
    const { url, stateToken } = await this.oidc.buildAuthorizationRequest(redirectUri);

    res.cookie(STATE_COOKIE, stateToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: STATE_COOKIE_MAX_AGE_MS,
      path: '/api/auth/oidc',
    });
    res.redirect(url);
  }

  @Public()
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!(await this.oidc.isConfigured())) {
      throw new NotFoundException('SSO is not configured on this server');
    }

    const stateCookie = readCookie(req, STATE_COOKIE);
    // Single-use: clear immediately so a replayed callback URL can't reuse it.
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/oidc' });

    const redirectUri = this.oidc.resolveRedirectUri(req);

    try {
      const authResponse = await this.oidc.handleCallback(query, stateCookie, redirectUri);
      const target = new URL('/login/sso-complete', webBaseUrl());
      target.hash = `token=${encodeURIComponent(authResponse.accessToken)}`;
      res.redirect(target.toString());
    } catch (err) {
      // Never surface raw error internals (may embed provider responses) — a
      // sanitised, user-facing message only. Land back on the login page
      // rather than a raw JSON error page, since this is a top-level
      // browser navigation, not a fetch call.
      const message =
        err instanceof BadRequestException
          ? extractMessage(err)
          : 'SSO sign-in failed — please try again';
      const target = new URL('/login', webBaseUrl());
      target.searchParams.set('ssoError', message);
      res.redirect(target.toString());
    }
  }
}

function extractMessage(err: BadRequestException): string {
  const response = err.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const m = (response as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join(', ');
  }
  return 'SSO sign-in failed — please try again';
}
