import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DashboardGadgetVisualization } from '@next-lane/shared';
import { DashboardGadgetConfigDto } from './dashboard-gadget-config.dto';

export class CreateDashboardGadgetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  /**
   * NLQL query — the single source of truth for which issues this gadget
   * covers. An empty string matches every issue in the project. Validated
   * against the project's custom fields before the gadget is persisted.
   */
  @IsString()
  @MaxLength(2000)
  query!: string;

  @IsEnum(DashboardGadgetVisualization)
  visualization!: DashboardGadgetVisualization;

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardGadgetConfigDto)
  config?: DashboardGadgetConfigDto;
}
