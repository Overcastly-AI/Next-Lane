import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateSavedFilterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  query!: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateSavedFilterDto extends PartialType(CreateSavedFilterDto) {}
