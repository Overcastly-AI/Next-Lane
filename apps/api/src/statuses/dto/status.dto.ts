import { IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
}

export class UpdateStatusDto extends PartialType(CreateStatusDto) {}
