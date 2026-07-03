import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;

  /**
   * Optional client-supplied idempotency key. Retrying a create with the SAME
   * key (scoped to the caller + this endpoint) within ~24h replays the
   * original created comment instead of posting a duplicate.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}

export class UpdateCommentDto extends PartialType(
  OmitType(CreateCommentDto, ['idempotencyKey'] as const),
) {}
