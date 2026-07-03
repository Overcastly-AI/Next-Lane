import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

  /**
   * New parent issue id, or null to detach every matching issue from its
   * current parent. Cross-project parentId is rejected per-item (the same
   * "parentId does not belong to this project" guard as `update_issue`) —
   * this is what lets one call parent 30 tickets under an epic.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;

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

  /**
   * When true, every issue in `ids` is validated first; if ALL pass, the
   * writes are applied inside a single database transaction (all-or-nothing
   * — a failure partway through rolls back everything already written in
   * this batch). When false/omitted (default), each issue is applied
   * independently and partial success is normal (see `failed`).
   */
  @IsOptional()
  @IsBoolean()
  atomic?: boolean;

  /**
   * When true, every issue is validated exactly as a real update would be,
   * but NOTHING is written — the response reports per-item verdicts
   * (`wouldUpdate` / `failed`) so a caller can preview a bulk edit before
   * committing to it. Works with or without `atomic`.
   */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
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
  /** Echoed back when the request set `atomic: true`. */
  atomic?: boolean;
  /**
   * True when this call had `dryRun: true` — no writes were made regardless
   * of `atomic`. `wouldUpdate` is populated instead of applying anything.
   */
  dryRun?: boolean;
  /** dryRun only: ids that passed every validation and WOULD have been updated. */
  wouldUpdate?: string[];
}
