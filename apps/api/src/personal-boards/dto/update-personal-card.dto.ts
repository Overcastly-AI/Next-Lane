import {
  IsHexColor,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdatePersonalCardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  notes?: string | null;

  /** Hex accent color (#rrggbb) or null to clear. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsHexColor()
  color?: string | null;

  /** Due date as an ISO 8601 string, or null to clear. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  dueDate?: string | null;

  /** Move the card to a different column. */
  @IsOptional()
  @IsString()
  columnId?: string;

  /**
   * ID of the card that should come immediately before this one in the
   * destination column. Pass null / omit to place at the start.
   */
  @IsOptional()
  @IsString()
  beforeId?: string;

  /**
   * ID of the card that should come immediately after this one in the
   * destination column. Pass null / omit to place at the end.
   */
  @IsOptional()
  @IsString()
  afterId?: string;
}
