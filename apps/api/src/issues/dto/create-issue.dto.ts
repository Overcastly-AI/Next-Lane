import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IssueType, Priority } from '@next-lane/shared';
import type { CustomFieldValue } from '@next-lane/shared';

export class CreateIssueDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsEnum(IssueType)
  type?: IssueType;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  storyPoints?: number;

  /** Optional start date. When both startDate and dueDate are provided, startDate must be <= dueDate. */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /**
   * Component to assign this issue to. Must belong to the same project.
   * When provided and no assigneeId is given, the component's defaultAssigneeId
   * is used as the initial assignee (if set).
   */
  @IsOptional()
  @IsString()
  componentId?: string;

  /**
   * Custom field values keyed by CustomFieldDefinition.id. Each value is
   * validated against the definition in the service layer (type, options,
   * appliesToTypes). Unknown keys are rejected.
   */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, CustomFieldValue>;

  /**
   * Original time estimate in minutes. Must be >= 0 when provided. Null clears
   * any existing estimate.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  originalEstimateMinutes?: number;
}
