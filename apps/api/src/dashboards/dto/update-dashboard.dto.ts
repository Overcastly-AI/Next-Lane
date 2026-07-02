import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateDashboardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  /** Display order among the project's dashboards (lower = earlier). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  order?: number;
}
