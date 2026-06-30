import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
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
  @IsInt()
  @Min(0)
  order?: number;
}
