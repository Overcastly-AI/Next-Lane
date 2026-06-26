import { IsString, MinLength, MaxLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;
}

export class UpdateCommentDto extends PartialType(CreateCommentDto) {}
