import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  IsObject,
  IsInt,
  MinLength,
  IsIn,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AutomationTrigger,
  AutomationActionType,
  Priority,
} from '@next-lane/shared';

/**
 * Per-action DTO with basic structural validation.
 * Deep param validation (e.g. Priority enum values, non-empty body) is
 * performed in AutomationsService.validateActionParams.
 */
export class AutomationActionInputDto {
  @IsEnum(AutomationActionType)
  type!: AutomationActionType;

  @IsObject()
  params!: Record<string, unknown>;
}

export class CreateAutomationRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsEnum(AutomationTrigger)
  trigger!: AutomationTrigger;

  @IsOptional()
  @IsString()
  condition?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationActionInputDto)
  actions!: AutomationActionInputDto[];

  @IsOptional()
  @IsInt()
  order?: number;
}
