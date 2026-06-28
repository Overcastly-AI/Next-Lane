import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { StatusCategory } from '@next-lane/shared';

export class CreateStatusDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsEnum(StatusCategory)
  category!: StatusCategory;

  @IsOptional()
  @IsInt()
  order?: number;

  /**
   * Optional WIP limit for this column.
   * - Omit or pass null to remove/clear any limit.
   * - Must be >= 1 when provided as a number.
   */
  @IsOptional()
  @ValidateIf((o: CreateStatusDto) => o.wipLimit !== null)
  @IsInt()
  @Min(1)
  wipLimit?: number | null;
}

export class UpdateStatusDto extends PartialType(CreateStatusDto) {}
