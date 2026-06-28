import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  IsInt,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AutomationTrigger,
} from '@next-lane/shared';
import { AutomationActionInputDto } from './create-automation-rule.dto';

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(AutomationTrigger)
  trigger?: AutomationTrigger;

  @IsOptional()
  @IsString()
  condition?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionInputDto)
  actions?: AutomationActionInputDto[];

  @IsOptional()
  @IsInt()
  order?: number;
}
