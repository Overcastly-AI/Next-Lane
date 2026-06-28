import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}

class UpdateChecklistItemBase {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

// PartialType would make all fields optional; we define explicitly to allow
// fine-grained validation (e.g. MinLength still applies when text is present).
export class UpdateChecklistItemDto extends PartialType(UpdateChecklistItemBase) {}

export class ReorderChecklistDto {
  @IsString({ each: true })
  itemIds!: string[];
}
