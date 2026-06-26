import { PartialType, OmitType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { CreateIssueDto } from './create-issue.dto';

/**
 * Update accepts the same fields as create (minus projectId), but additionally
 * allows `null` on the optional relation/value fields so the client can clear
 * them (e.g. unparent an issue, remove story points, unassign). `ValidateIf`
 * skips the type check when the value is explicitly `null`.
 */
export class UpdateIssueDto extends PartialType(
  OmitType(CreateIssueDto, [
    'projectId',
    'parentId',
    'assigneeId',
    'sprintId',
    'storyPoints',
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
}
