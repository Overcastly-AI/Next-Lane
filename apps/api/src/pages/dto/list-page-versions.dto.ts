import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params for `GET /pages/:id/versions`. Newest-first, cursor-paginated. */
export class ListPageVersionsQueryDto {
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
