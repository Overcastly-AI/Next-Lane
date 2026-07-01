import {
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePersonalColumnDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /** Hex accent color (#rrggbb) or null to clear. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsHexColor()
  color?: string | null;
}
