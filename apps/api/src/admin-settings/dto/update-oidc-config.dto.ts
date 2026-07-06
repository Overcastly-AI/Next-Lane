import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@next-lane/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Only http(s) issuer URLs are accepted — no javascript:/data: shortcuts.
 * TLDs are NOT required: self-hosters routinely run Keycloak/Authentik on
 * `http://localhost:8080` or a bare internal hostname (mirrors the existing
 * QuickLink URL_OPTIONS pattern).
 */
const ISSUER_URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

/**
 * Body for `PATCH /admin/oidc-config`. Every field is optional — the service
 * merges onto the existing stored row, so a partial save (e.g. just flipping
 * `enabled`) never clobbers the rest. `clientSecret` is write-only: omit it
 * to keep the currently-stored secret unchanged; there is no "clear secret"
 * affordance separate from disabling the whole config.
 */
export class UpdateOidcConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  @IsUrl(ISSUER_URL_OPTIONS, { message: 'issuerUrl must be a valid http(s) URL' })
  issuerUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  clientId?: string;

  /** The raw OIDC client secret. Write-only — never echoed back by any GET. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(100)
  label?: string;

  /**
   * SSO/OIDC Phase 2 — JIT provisioning for this (legacy) provider. `null`
   * explicitly clears (disables) it; omit to leave the existing rule
   * unchanged. `@ValidateIf` lets `null` through class-validator's
   * `@IsString` check (which otherwise rejects it) while still validating a
   * real string when one is provided.
   */
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
