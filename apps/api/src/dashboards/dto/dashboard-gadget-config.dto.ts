import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Visualization + grid-layout settings for a gadget. Nested/validated on
 * `CreateDashboardGadgetDto`/`UpdateDashboardGadgetDto` via `@ValidateNested`
 * + `@Type`. All fields optional — which ones matter depends on the gadget's
 * `visualization` (enforced in the service layer, since that's a
 * cross-field rule `class-validator` can't express cleanly).
 */
export class DashboardGadgetConfigDto {
  /**
   * Grid order — lower renders earlier. A fractional/midpoint value, NOT a
   * dense integer: drag-to-reorder computes the new position as the
   * numeric midpoint between the two new neighbors (or ±1 past an end) so
   * only the ONE moved gadget is ever written — never a renumber of the
   * whole list. Can be negative (repeatedly moving something to the very
   * front) or fractional (e.g. 1.5) — `@IsInt()` would reject both.
   */
  @IsOptional()
  @IsNumber()
  @Min(-1_000_000)
  @Max(1_000_000)
  position?: number;

  /** Grid column span (1 = default, 2 = wide). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  size?: number;

  /**
   * BREAKDOWN: field to group by — one of status/assignee/priority/type/
   * label/component, or a custom SELECT field's key.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;

  /** TABLE: issue columns to show (subset of key/title/status/assignee/points). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  columns?: string[];

  /** TABLE: max rows to display (server also hard-caps this). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** VELOCITY_TREND: number of most-recent sprints to include (server also clamps). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  sprints?: number;
}
