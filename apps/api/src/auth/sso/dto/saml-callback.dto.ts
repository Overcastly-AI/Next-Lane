import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Upper bound on the base64 SAMLResponse before XML parsing — defense in
 * depth beside the global body-size limit (security review on 5e0fe6c).
 * Real assertions are a few KB; 512 KB is generous for multi-cert chains
 * while still bounding a hostile blob well before it reaches the XML parser.
 */
const MAX_SAML_RESPONSE_BYTES = 512 * 1024;

/**
 * Body for `POST /auth/sso/:slug/callback` — the SAML ACS endpoint. IdPs
 * `<form method="post">`-submit exactly these two fields (HTTP-POST binding);
 * anything else in the body is stripped by the global `ValidationPipe`'s
 * whitelist.
 */
export class SamlCallbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SAML_RESPONSE_BYTES)
  SAMLResponse!: string;

  /** Echoes the value we sent as `RelayState` (the provider slug) — not relied on for routing (the `:slug` path param is authoritative), read only for logging/diagnostics. */
  @IsOptional()
  @IsString()
  RelayState?: string;
}
