import {
  IsHexColor,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreatePersonalCardDto {
  @IsString()
  columnId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  notes?: string;

  /** Hex accent color (#rrggbb) or null for none. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsHexColor()
  color?: string | null;

  /** Due date as an ISO 8601 string, or null for none. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  dueDate?: string | null;
}
