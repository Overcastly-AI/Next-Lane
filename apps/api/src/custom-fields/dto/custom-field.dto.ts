import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CustomFieldType, IssueType } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export class CreateCustomFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsEnum(CustomFieldType)
  type!: CustomFieldType;

  /**
   * Required (and non-empty) for SELECT / MULTI_SELECT; must be absent or
   * empty for all other types. Validation is enforced in the service layer
   * because the rule depends on the value of `type`.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(IssueType, { each: true })
  appliesToTypes?: IssueType[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnCard?: boolean;
}

// ---------------------------------------------------------------------------
// Update — type and key are IMMUTABLE and intentionally excluded here.
// ---------------------------------------------------------------------------

export class UpdateCustomFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  /**
   * For SELECT / MULTI_SELECT: replacement list of allowed options (must be
   * non-empty). Forbidden for other types. Validated in the service layer.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(IssueType, { each: true })
  appliesToTypes?: IssueType[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  showOnCard?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}
