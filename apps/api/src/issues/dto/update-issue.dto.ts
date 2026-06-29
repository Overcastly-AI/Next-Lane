import { PartialType, OmitType } from '@nestjs/swagger';
import { IsDateString, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { CreateIssueDto } from './create-issue.dto';
import type { CustomFieldValue } from '@next-lane/shared';

/**
 * Update accepts the same fields as create (minus projectId), but additionally
 * allows `null` on the optional relation/value fields so the client can clear
 * them (e.g. unparent an issue, remove story points, unassign, clear dueDate,
 * remove component assignment).
 * `ValidateIf` skips the type check when the value is explicitly `null`.
 */
export class UpdateIssueDto extends PartialType(
  OmitType(CreateIssueDto, [
    'projectId',
    'parentId',
    'assigneeId',
    'sprintId',
    'storyPoints',
    'dueDate',
    'componentId',
    'originalEstimateMinutes',
  ] as const),
) {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  sprintId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(999)
  storyPoints?: number | null;

  /** ISO 8601 date string or null to clear the due date. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  /** Component id or null to clear the component assignment. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  componentId?: string | null;

  /**
   * Partial custom field update. Only the keys present in this object are
   * changed; keys not mentioned are left untouched (MERGE semantics). Setting a
   * key to `null` clears that field's value on the issue. Unknown definition ids
   * are rejected by the service layer.
   */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, CustomFieldValue>;

  /**
   * Original time estimate in minutes. null clears any existing estimate. Must
   * be >= 0 when a non-null value is provided.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  originalEstimateMinutes?: number | null;
}
