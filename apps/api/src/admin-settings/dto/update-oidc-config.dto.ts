import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

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
}
