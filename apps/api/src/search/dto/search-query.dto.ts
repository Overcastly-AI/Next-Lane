import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SEARCH_GROUPS, SEARCH_MAX_LIMIT, type SearchGroup } from '@next-lane/shared';

export class SearchQueryDto {
  /** Free-text query. Matched (case-insensitive contains) against issue title,
   *  description, and key (e.g. "NL-12"), plus project name/key, page
   *  title/content, and comment bodies. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  /** Optional: restrict the search to a single project the caller can access. */
  @IsOptional()
  @IsString()
  projectId?: string;

  /**
   * Page size, applied INDEPENDENTLY to each result group. A real server-side
   * `LIMIT` — not a client-side slice of a fixed cap, which is what this
   * replaced (matches past #20 used to be unreachable and silently invisible).
   * Capped at {@link SEARCH_MAX_LIMIT} because every hit now carries a
   * generated snippet, so page size is a token budget as well as a row count.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEARCH_MAX_LIMIT)
  limit?: number;

  /** Rows to skip within each group. Pair with `paging.<group>.hasMore`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /**
   * Comma-separated subset of result groups to compute, e.g. `groups=comments`
   * or `groups=issues,pages`. Omitted = all of them.
   *
   * This is a cost control, not cosmetic filtering: each group is its own
   * database query, so a caller that only wants comments should not pay for
   * three more. Groups left out still appear in the response as empty arrays
   * with zeroed paging, so consumers never have to null-check.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((g) => g.trim())
          .filter((g) => g.length > 0)
      : value,
  )
  @IsIn(SEARCH_GROUPS as readonly string[], { each: true })
  groups?: SearchGroup[];
}
