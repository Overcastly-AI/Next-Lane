import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@next-lane/shared';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  /**
   * Hex brand color to set, or null to clear.
   * Must match /^#[0-9a-fA-F]{6}$/ when provided as a string.
   */
  @IsOptional()
  @ValidateIf((o: UpdateWorkspaceDto) => o.brandColor !== null)
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'brandColor must be a valid 6-digit hex color (e.g. #1a2b3c) or null',
  })
  brandColor?: string | null;
}

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
