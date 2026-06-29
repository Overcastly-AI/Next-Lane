import {
  IsArray,
  IsEnum,
  IsHexColor,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BoardType } from '@next-lane/shared';

export class BoardColorRuleDto {
  @IsString()
  @MaxLength(200)
  id!: string;

  @IsString()
  @MaxLength(500)
  query!: string;

  @IsHexColor()
  color!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateBoardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(BoardType)
  type?: BoardType;

  /**
   * filterQuery: null clears the saved filter; omitting the field leaves it
   * unchanged. MaxLength 2000 matches the projects description convention.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  filterQuery?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoardColorRuleDto)
  colorRules?: BoardColorRuleDto[];

  /**
   * ID of the named Workflow to assign to this board, or null to clear.
   * When set to a non-null value the workflow must belong to the board's project.
   * null = fall back to the project-level legacy workflowEnforced enforcement.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  workflowId?: string | null;
}
