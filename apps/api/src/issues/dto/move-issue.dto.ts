import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class MoveIssueDto {
  @IsString()
  statusId!: string;

  @IsOptional()
  @IsString()
  beforeId?: string;

  @IsOptional()
  @IsString()
  afterId?: string;
}

export class ListIssuesQueryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  sprintId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  q?: string;

  /**
   * Opaque pagination cursor returned as `nextCursor` from a previous page.
   * When present, results continue strictly after the referenced issue.
   */
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * Page size. Defaults to {@link DEFAULT_ISSUES_PAGE_SIZE} and is capped at
   * {@link MAX_ISSUES_PAGE_SIZE}. Coerced from the query string to a number.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
