import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PokerState, POKER_DECK } from '@next-lane/shared';

// ── Create Session ────────────────────────────────────────────────────────────

export class CreatePokerSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  issueIds!: string[];
}

// ── Update Session ────────────────────────────────────────────────────────────

export class UpdatePokerSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(PokerState)
  state?: PokerState;

  @IsOptional()
  @IsString()
  activeItemId?: string | null;
}

// ── Add Item ──────────────────────────────────────────────────────────────────

export class AddPokerItemDto {
  @IsString()
  issueId!: string;
}

// ── Cast Vote ─────────────────────────────────────────────────────────────────

export class CastVoteDto {
  @IsIn(POKER_DECK as unknown as string[])
  value!: string;
}

// ── Commit Estimate ───────────────────────────────────────────────────────────

export class CommitEstimateDto {
  @IsNumber()
  finalEstimate!: number;
}
