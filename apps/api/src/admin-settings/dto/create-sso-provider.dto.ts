/**
 * Body for `POST /admin/sso-providers` — SSO/OIDC Phase 2, the N-simultaneous
 * -providers list (alongside, not replacing, the legacy `/admin/oidc-config`
 * singleton). One row per additional identity provider (OIDC or SAML).
 *
 * `type`-specific fields are validated as REQUIRED-when-enabling in the
 * service layer (`SsoProvidersService.create`), not here — class-validator
 * has no clean "required iff sibling field equals X" primitive, and the same
 * manual pattern is already established by
 * `AdminSettingsService.updateOidcConfig`'s own enable-time checks.
 */
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role, SsoProviderType } from '@next-lane/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Only http(s) URLs are accepted — no javascript:/data: shortcuts. TLDs are
 * NOT required: self-hosters routinely run Keycloak/Authentik/simpleSAMLphp
 * on `http://localhost:8080` or a bare internal hostname (mirrors
 * `update-oidc-config.dto.ts`'s own `ISSUER_URL_OPTIONS`).
 */
const URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

/** Lowercase alphanumeric segments joined by single hyphens — e.g. `okta-eng`, `corp-adfs`. No leading/trailing/double hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateSsoProviderDto {
  @IsEnum(SsoProviderType)
  type!: SsoProviderType;

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  /** Auto-generated (slugified) from `label` when omitted; immutable after creation. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be lowercase alphanumeric segments joined by single hyphens (e.g. "okta-eng")',
  })
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // ── OIDC (type === OIDC) ──────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  @IsUrl(URL_OPTIONS, { message: 'issuerUrl must be a valid http(s) URL' })
  issuerUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  clientId?: string;

  /** Write-only — never echoed back by any GET. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  clientSecret?: string;

  // ── SAML (type === SAML) ──────────────────────────────────────────────────

  /** The IdP's SSO endpoint (HTTP-Redirect binding). */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  @IsUrl(URL_OPTIONS, { message: 'samlEntryPoint must be a valid http(s) URL' })
  samlEntryPoint?: string;

  /** The IdP's Entity ID. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  samlIdpIssuer?: string;

  /**
   * One or more PEM-encoded X.509 certificates (concatenated) used to verify
   * the IdP's signature. Required to enable a SAML provider — SAML responses
   * are NEVER accepted unsigned (see `saml.service.ts`). Sanity-checked for
   * PEM markers in the service layer.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  samlIdpCertificate?: string;

  /** Our SP Entity ID / expected audience. Defaults to a computed value when omitted (see `SsoProvider`'s Prisma doc comment). */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  samlSpEntityId?: string;

  // ── JIT provisioning (applies to both types) ──────────────────────────────

  /** `null` explicitly means "no JIT" (also the default when omitted on create). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  jitDefaultWorkspaceId?: string | null;

  @IsOptional()
  @IsEnum(Role)
  jitDefaultRole?: Role;
}
