/**
 * SsoController — SSO/OIDC Phase 2 runtime routes for the N-simultaneous
 * -providers list (`/api/auth/sso/:slug/*`), additive alongside the
 * untouched Phase-1 `/api/auth/oidc/*` routes (`oidc.controller.ts`).
 *
 * Route shape mirrors the legacy controller closely (full-page browser
 * navigations, state carried via a short-lived httpOnly signed-JWT cookie
 * for the OIDC path) with one addition: `:slug` identifies WHICH configured
 * provider a request is for, since there can now be more than one.
 *
 * `GET  /auth/sso/:slug/login`    — works for both OIDC and SAML providers
 *                                    (both redirect the browser to the IdP).
 * `GET  /auth/sso/:slug/callback` — OIDC only (authorization-code redirect
 *                                    with query params); 404s for a SAML slug.
 * `POST /auth/sso/:slug/callback` — SAML only (ACS endpoint — the IdP
 *                                    `<form method="post">`-submits the
 *                                    assertion here); 404s for an OIDC slug.
 *
 * No IdP-initiated SAML flow (an IdP-side "launch" that POSTs directly to
 * the ACS without us ever having sent an AuthnRequest) — v1 is SP-initiated
 * only, matching the OIDC flow's own shape and avoiding the extra
 * unsolicited-response validation surface IdP-initiated SSO requires.
 *
 * Both callback routes are `@Public()` — full-page navigations with no
 * bearer token, matching `oidc.controller.ts`'s own reasoning exactly.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SsoProviderType } from '@next-lane/shared';
import { Public } from '../public.decorator';
import { SsoService } from './sso.service';
import { SamlCallbackDto } from './dto/saml-callback.dto';

/** Name of the short-lived cookie carrying the signed OIDC state/nonce/PKCE-verifier token. Distinct from the legacy `nl_oidc_state` cookie (different path scope) so a concurrent legacy + multi-provider login attempt in the same browser can't clobber each other. */
const STATE_COOKIE = 'nl_sso_oidc_state';
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? process.env.RESET_BASE_URL ?? 'http://localhost:3000';
}

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

@ApiExcludeController()
@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Public()
  @Get(':slug/login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Param('slug') slug: string,
  ): Promise<void> {
    const provider = await this.sso.getEnabledProvider(slug);
    if (!provider) {
      throw new NotFoundException('SSO provider not found or not enabled');
    }

    const callbackUrl = this.sso.resolveCallbackUrl(req, slug);

    if (provider.type === SsoProviderType.OIDC) {
      const { url, stateToken } = await this.sso.buildOidcAuthorizationRequest(provider, callbackUrl);
      res.cookie(STATE_COOKIE, stateToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        maxAge: STATE_COOKIE_MAX_AGE_MS,
        path: `/api/auth/sso/${slug}`,
      });
      res.redirect(url);
      return;
    }

    const url = await this.sso.buildSamlLoginUrl(provider, callbackUrl);
    res.redirect(url);
  }

  @Public()
  @Get(':slug/callback')
  async oidcCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const provider = await this.sso.getEnabledProvider(slug);
    if (!provider || provider.type !== SsoProviderType.OIDC) {
      throw new NotFoundException('SSO provider not found or not enabled');
    }

    const stateCookie = readCookie(req, STATE_COOKIE);
    // Single-use: clear immediately so a replayed callback URL can't reuse it.
    res.clearCookie(STATE_COOKIE, { path: `/api/auth/sso/${slug}` });

    const callbackUrl = this.sso.resolveCallbackUrl(req, slug);

    try {
      const authResponse = await this.sso.handleOidcCallback(provider, query, stateCookie, callbackUrl);
      redirectToSsoComplete(res, authResponse.accessToken);
    } catch (err) {
      redirectToLoginError(res, err);
    }
  }

  @Public()
  @Post(':slug/callback')
  async samlCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Param('slug') slug: string,
    @Body() body: SamlCallbackDto,
  ): Promise<void> {
    const provider = await this.sso.getEnabledProvider(slug);
    if (!provider || provider.type !== SsoProviderType.SAML) {
      throw new NotFoundException('SSO provider not found or not enabled');
    }

    const callbackUrl = this.sso.resolveCallbackUrl(req, slug);

    try {
      const authResponse = await this.sso.handleSamlCallback(provider, callbackUrl, body.SAMLResponse);
      redirectToSsoComplete(res, authResponse.accessToken);
    } catch (err) {
      redirectToLoginError(res, err);
    }
  }
}

function redirectToSsoComplete(res: Response, accessToken: string): void {
  const target = new URL('/login/sso-complete', webBaseUrl());
  target.hash = `token=${encodeURIComponent(accessToken)}`;
  res.redirect(target.toString());
}

function redirectToLoginError(res: Response, err: unknown): void {
  // Never surface raw error internals (may embed provider responses) — a
  // sanitised, user-facing message only. Land back on the login page rather
  // than a raw JSON error page, since this is a top-level browser
  // navigation, not a fetch call (mirrors `oidc.controller.ts` exactly).
  const message = err instanceof BadRequestException ? extractMessage(err) : 'SSO sign-in failed — please try again';
  const target = new URL('/login', webBaseUrl());
  target.searchParams.set('ssoError', message);
  res.redirect(target.toString());
}
