import {
  ArrayMaxSize,
  IsArray,
  IsInt,
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
  /** Grid order — lower renders earlier. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
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
}
