import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for GET /projects/:id/activity.
 *
 * Ascending-cursor pagination (keyset on createdAt ASC, id ASC) — unlike the
 * audit log's newest-first DESC cursor — because the primary use case is "walk
 * forward from a known point in time" (an agent's `since`), not "browse the
 * most recent N". Omitting both `since` and `cursor` starts from the
 * beginning of the project's history; combine with a small `limit` and follow
 * `nextCursor` to page forward from there.
 */
export class ListProjectActivityQueryDto {
  /** Only return activity strictly newer than this ISO-8601 timestamp. */
  @IsOptional()
  @IsDateString()
  since?: string;

  /** Opaque pagination cursor returned as `nextCursor` from a previous page. */
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
