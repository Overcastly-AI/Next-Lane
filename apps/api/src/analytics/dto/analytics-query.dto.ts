import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for analytics endpoints that accept an optional `days` window.
 *
 * The global ValidationPipe (whitelist + transform) enforces:
 *   - When omitted: `days` is undefined (service defaults to 30).
 *   - When provided: must be an integer in [1, 366]. Invalid values → 400.
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
}
