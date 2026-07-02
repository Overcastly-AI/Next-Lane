import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IssueType, WorkflowGateType } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Gate DTO (nested inside CreateWorkflowTransitionDto / PatchWorkflowTransitionDto)
// ---------------------------------------------------------------------------

export class WorkflowGateDtoClass {
  @IsEnum(WorkflowGateType)
  type!: WorkflowGateType;

  /**
   * Required (non-empty) when type === REQUIRE_FIELD. Core field name (e.g.
   * "storyPoints", "dueDate", "priority", "assignee") or a custom field's
   * `key`/`name`. A blank value would silently no-op the gate at evaluation
   * time (WF-3), so it's rejected here with a 400 instead.
   */
  @ValidateIf((o: WorkflowGateDtoClass) => o.type === WorkflowGateType.REQUIRE_FIELD)
  @IsString()
  @MinLength(1, { message: 'field must not be empty when gate type is REQUIRE_FIELD' })
  field?: string;

  /**
   * Required (non-empty) when type === REQUIRE_LINK. The link type string
   * (e.g. "BLOCKS").
   */
  @ValidateIf((o: WorkflowGateDtoClass) => o.type === WorkflowGateType.REQUIRE_LINK)
  @IsString()
  @MinLength(1, { message: 'linkType must not be empty when gate type is REQUIRE_LINK' })
  linkType?: string;
}

// ---------------------------------------------------------------------------
// Create transition
// ---------------------------------------------------------------------------

export class CreateWorkflowTransitionDto {
  /**
   * Null means "from any status" (wildcard). Must be a Status id that belongs
   * to the project when non-null. Omitting is treated as null.
   */
  @IsOptional()
  @IsString()
  fromStatusId?: string | null;

  /**
   * The destination status id. Must belong to the project.
   */
  @IsString()
  toStatusId!: string;

  /**
   * When set, only applies to issues of this type. Null = all types.
   */
  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType | null;

  /**
   * Optional human-readable transition label (e.g. "Start Work").
   */
  @IsOptional()
  @IsString()
  name?: string;

  /**
   * Ordered gate rules. Empty array = no gates (always permitted).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowGateDtoClass)
  gates?: WorkflowGateDtoClass[];
}

// ---------------------------------------------------------------------------
// Named workflow entity DTOs (new per-board workflow feature)
// ---------------------------------------------------------------------------

/** POST /projects/:projectId/workflows */
export class CreateNamedWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enforced?: boolean;
}

/** PATCH /workflows/:id */
export class UpdateNamedWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enforced?: boolean;
}

/**
 * POST /projects/:projectId/workflows/from-template
 *
 * template:
 *  'simple'     – linear TODO→IN_PROGRESS→DONE only
 *  'kanban'     – any status → any other status (fully permissive)
 *  'scrum'      – linear forward + back-transitions (IN_PROGRESS↔TODO, etc.)
 *  'bug-triage' – linear + a reopen path from DONE back to TODO
 */
export class CreateWorkflowFromTemplateDto {
  @IsEnum(['simple', 'kanban', 'scrum', 'bug-triage'])
  template!: 'simple' | 'kanban' | 'scrum' | 'bug-triage';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}

// ---------------------------------------------------------------------------
// Patch workflow settings (enforced flag)
// ---------------------------------------------------------------------------

export class PatchWorkflowDto {
  @IsBoolean()
  enforced!: boolean;
}

// ---------------------------------------------------------------------------
// Patch transition (partial update)
// ---------------------------------------------------------------------------

export class PatchWorkflowTransitionDto {
  @IsOptional()
  @IsString()
  fromStatusId?: string | null;

  @IsOptional()
  @IsString()
  toStatusId?: string;

  @IsOptional()
  @IsEnum(IssueType)
  issueType?: IssueType | null;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowGateDtoClass)
  gates?: WorkflowGateDtoClass[];
}
