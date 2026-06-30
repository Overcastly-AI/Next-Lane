import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Only http(s) links are accepted — no javascript:/data: shortcuts. TLDs are
 * NOT required: self-hosters routinely link to `http://localhost:3000`, bare
 * internal hostnames, or LAN IPs for their own tools.
 */
const URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty string → null, otherwise trim. Used for optional, clearable fields. */
const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? null : t;
};

export class CreateQuickLinkDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsString()
  @Transform(trim)
  @MaxLength(2048)
  @IsUrl(URL_OPTIONS, { message: 'url must be a valid http(s) URL' })
  url!: string;

  /** Hex accent color (#rrggbb) or null/empty to leave unset. */
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a 6-digit hex color (e.g. #2563eb) or null',
  })
  color?: string | null;

  /** Free-text group name, or null/empty for ungrouped. */
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  group?: string | null;
}

export class UpdateQuickLinkDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2048)
  @IsUrl(URL_OPTIONS, { message: 'url must be a valid http(s) URL' })
  url?: string;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a 6-digit hex color (e.g. #2563eb) or null',
  })
  color?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  group?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
