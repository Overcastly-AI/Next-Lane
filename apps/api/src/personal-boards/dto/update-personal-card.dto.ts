import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePersonalCardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  notes?: string;

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
