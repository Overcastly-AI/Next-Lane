import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IssueType, Priority } from '@next-lane/shared';

export class CreateIssueTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  titleTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  descriptionTemplate?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  defaultAssigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  componentId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];
}

export class UpdateIssueTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(300)
  titleTemplate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(50000)
  descriptionTemplate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(Priority)
  priority?: Priority | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  defaultAssigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  componentId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];
}

/**
 * Body for POST /issue-templates/:id/create-issue.
 * All fields override the template value when provided.
 */
export class CreateIssueFromTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  componentId?: string | null;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];
}
