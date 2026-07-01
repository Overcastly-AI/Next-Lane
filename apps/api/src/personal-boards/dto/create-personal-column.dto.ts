import {
  IsHexColor,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreatePersonalColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** Optional hex accent color (#rrggbb) or null for none. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsHexColor()
  color?: string | null;
}
