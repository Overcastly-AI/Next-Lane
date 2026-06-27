import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for GET /workspaces/:id/audit-log.
 * Cursor-paginated (keyset on createdAt DESC, id DESC) to match the issues pattern.
 */
export class ListAuditEventsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
