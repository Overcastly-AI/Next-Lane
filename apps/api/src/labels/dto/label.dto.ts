import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  // Must be a valid 6-digit CSS hex color (e.g. #ef4444).
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'color must be a valid 6-digit hex color, e.g. #ef4444',
  })
  color?: string;
}

export class AddIssueLabelDto {
  @IsString()
  labelId!: string;
}
