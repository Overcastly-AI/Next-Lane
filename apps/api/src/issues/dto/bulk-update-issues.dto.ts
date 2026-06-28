import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IssueType, Priority } from '@next-lane/shared';

/**
 * The fields that can be changed in a bulk edit.
 *
 * Rules:
 *  - `assigneeId` and `sprintId` accept `null` to clear the field (matches the
 *    single-issue update semantics — `ValidateIf` skips the type check on null).
 *  - At least one field must be set; the service enforces this guard (the
 *    BulkUpdateIssuesDto validator also checks via `@ValidateNested`).
 *  - `addLabelIds`, when present, must be a non-empty array of strings (IDs of
 *    labels to attach; duplicates are tolerated — `upsert` is idempotent).
 */
export class BulkIssueChangesDto {
  @IsOptional()
  @IsString()
  statusId?: string;

  /** null = clear the assignee. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  /** null = remove the issue from its sprint. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  sprintId?: string | null;

  @IsOptional()
  @IsEnum(IssueType)
  type?: IssueType;

  /** Label IDs to attach to every matching issue (idempotent upsert). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addLabelIds?: string[];
}

export class BulkUpdateIssuesDto {
  /**
   * IDs of the issues to update. Must contain 1–100 entries.
   * More than 100 is rejected with a 400 to prevent runaway batch operations.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];

  @ValidateNested()
  @Type(() => BulkIssueChangesDto)
  changes!: BulkIssueChangesDto;
}

/**
 * Shape returned by POST /issues/bulk.
 *
 * `updated` is the count of issues that were successfully modified.
 * `failed` lists any ids that could not be updated and the reason why
 * (e.g. not found, insufficient permissions, validation error). The caller
 * can inspect this list to surface partial-failure feedback in the UI.
 */
export interface BulkUpdateResultDto {
  updated: number;
  failed: Array<{ id: string; reason: string }>;
}
