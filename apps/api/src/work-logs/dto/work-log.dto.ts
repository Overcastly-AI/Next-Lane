import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWorkLogDto {
  @IsInt()
  @Min(1)
  minutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** ISO 8601 datetime; defaults to now when omitted. */
  @IsOptional()
  @IsDateString()
  workedAt?: string;
}

export class UpdateWorkLogDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** ISO 8601 datetime. */
  @IsOptional()
  @IsDateString()
  workedAt?: string;
}
