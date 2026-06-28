import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { VersionState } from '@next-lane/shared';

export class CreateVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  releaseDate?: string | null;
}

export class UpdateVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsEnum(VersionState)
  state?: VersionState;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  releaseDate?: string | null;
}

export class SetIssueVersionsDto {
  @IsString({ each: true })
  versionIds!: string[];
}
