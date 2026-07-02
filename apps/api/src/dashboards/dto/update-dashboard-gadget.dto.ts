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

export class UpdateDashboardGadgetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  query?: string;

  @IsOptional()
  @IsEnum(DashboardGadgetVisualization)
  visualization?: DashboardGadgetVisualization;

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardGadgetConfigDto)
  config?: DashboardGadgetConfigDto;
}
