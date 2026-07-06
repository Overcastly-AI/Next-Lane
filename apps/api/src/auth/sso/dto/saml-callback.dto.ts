import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body for `POST /auth/sso/:slug/callback` — the SAML ACS endpoint. IdPs
 * `<form method="post">`-submit exactly these two fields (HTTP-POST binding);
 * anything else in the body is stripped by the global `ValidationPipe`'s
 * whitelist.
 */
export class SamlCallbackDto {
  @IsString()
  @MinLength(1)
  SAMLResponse!: string;

  /** Echoes the value we sent as `RelayState` (the provider slug) — not relied on for routing (the `:slug` path param is authoritative), read only for logging/diagnostics. */
  @IsOptional()
  @IsString()
  RelayState?: string;
}
