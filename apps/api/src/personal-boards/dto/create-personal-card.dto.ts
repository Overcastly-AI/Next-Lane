import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
