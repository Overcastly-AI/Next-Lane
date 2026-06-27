import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IssueType, Priority } from '@next-lane/shared';

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

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
