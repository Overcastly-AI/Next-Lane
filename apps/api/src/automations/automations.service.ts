import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import {
  AutomationTrigger,
  AutomationActionType,
  AutomationRunStatus,
  Priority,
  Role,
  validateQuery,
} from '@next-lane/shared';
import type {
  AutomationRuleDto,
  AutomationRunDto,
  AutomationActionDto,
  AutomationRunActionDto,
  ValidateCustomFieldDef,
} from '@next-lane/shared';
import { CreateAutomationRuleDto, AutomationActionInputDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: string;
  condition: string | null;
  actions: Prisma.JsonValue;
  order: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RunRow {
  id: string;
  ruleId: string;
  issueId: string | null;
  trigger: string;
  matched: boolean;
  status: string;
  actionsApplied: Prisma.JsonValue;
  error: string | null;
  createdAt: Date;
  rule?: { name: string };
  issue?: {
    id: string;
    number: number;
    project: { key: string };
  } | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function coerceActions(raw: Prisma.JsonValue): AutomationActionDto[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Prisma.JsonArray).filter(
    (item): item is Prisma.JsonObject =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  ) as unknown as AutomationActionDto[];
}

function coerceRunActions(raw: Prisma.JsonValue): AutomationRunActionDto[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Prisma.JsonArray).filter(
    (item): item is Prisma.JsonObject =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  ) as unknown as AutomationRunActionDto[];
}

export function toAutomationRuleDto(row: RuleRow): AutomationRuleDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    trigger: row.trigger as AutomationTrigger,
    condition: row.condition,
    actions: coerceActions(row.actions),
    order: row.order,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAutomationRunDto(row: RunRow): AutomationRunDto {
  const dto: AutomationRunDto = {
    id: row.id,
    ruleId: row.ruleId,
    issueId: row.issueId,
    trigger: row.trigger as AutomationTrigger,
    matched: row.matched,
    status: row.status as AutomationRunStatus,
    actionsApplied: coerceRunActions(row.actionsApplied),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.rule) dto.ruleName = row.rule.name;
  if (row.issue !== undefined) {
    dto.issueKey = row.issue
      ? `${row.issue.project.key}-${row.issue.number}`
      : null;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Per-action param validation
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = new Set<string>(Object.values(Priority));

/**
 * Validates that `action.params` contains the required keys for its type.
 * Throws BadRequestException on invalid params — called at create/update time
 * so bad configs are caught before they run.
 */
export function validateActionParams(action: AutomationActionInputDto): void {
  const { type, params } = action;
  switch (type) {
    case AutomationActionType.ASSIGN:
      // assigneeId may be null (unassign) or a string id
      if (params.assigneeId !== null && params.assigneeId !== undefined && typeof params.assigneeId !== 'string') {
        throw new BadRequestException(`ASSIGN action requires assigneeId (string or null)`);
      }
      break;
    case AutomationActionType.SET_PRIORITY:
      if (typeof params.priority !== 'string' || !VALID_PRIORITIES.has(params.priority)) {
        throw new BadRequestException(
          `SET_PRIORITY action requires a valid priority (${Object.values(Priority).join(', ')})`,
        );
      }
      break;
    case AutomationActionType.TRANSITION:
      if (typeof params.statusId !== 'string' || !params.statusId) {
        throw new BadRequestException('TRANSITION action requires statusId (string)');
      }
      break;
    case AutomationActionType.ADD_LABEL:
      if (typeof params.labelId !== 'string' || !params.labelId) {
        throw new BadRequestException('ADD_LABEL action requires labelId (string)');
      }
      break;
    case AutomationActionType.ADD_COMMENT:
      if (typeof params.body !== 'string' || !(params.body as string).trim()) {
        throw new BadRequestException('ADD_COMMENT action requires a non-empty body (string)');
      }
      break;
    case AutomationActionType.SET_CUSTOM_FIELD:
      if (typeof params.fieldId !== 'string' || !params.fieldId) {
        throw new BadRequestException('SET_CUSTOM_FIELD action requires fieldId (string)');
      }
      if (params.value === undefined) {
        throw new BadRequestException('SET_CUSTOM_FIELD action requires value');
      }
      break;
    default:
      throw new BadRequestException(`Unknown action type: ${String(type)}`);
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Shared helpers ─────────────────────────────────────────────────────────

  private async loadCustomFieldDefs(
    projectId: string,
  ): Promise<ValidateCustomFieldDef[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
      select: { id: true, key: true, name: true, type: true },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type as ValidateCustomFieldDef['type'],
    }));
  }

  private assertValidCondition(condition: string, customFieldDefs: ValidateCustomFieldDef[]): void {
    const result = validateQuery(condition, { customFieldDefs });
    if (!result.ok) {
      throw new BadRequestException(
        `Invalid NLQL condition: ${result.error?.message ?? 'parse error'}`,
      );
    }
  }

  private async loadRule(ruleId: string): Promise<RuleRow> {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException('Automation rule not found');
    return rule;
  }

  // ── List rules ────────────────────────────────────────────────────────────

  async findAll(userId: string, projectId: string): Promise<AutomationRuleDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const rows = await this.prisma.automationRule.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAutomationRuleDto);
  }

  // ── Get one rule ──────────────────────────────────────────────────────────

  async findOne(userId: string, ruleId: string): Promise<AutomationRuleDto> {
    const rule = await this.loadRule(ruleId);
    await assertProjectMember(this.prisma, userId, rule.projectId);
    return toAutomationRuleDto(rule);
  }

  // ── Create rule ───────────────────────────────────────────────────────────

  async create(
    userId: string,
    projectId: string,
    dto: CreateAutomationRuleDto,
  ): Promise<AutomationRuleDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    if (dto.condition) {
      const customFieldDefs = await this.loadCustomFieldDefs(projectId);
      this.assertValidCondition(dto.condition, customFieldDefs);
    }

    if (!dto.actions || dto.actions.length === 0) {
      throw new BadRequestException('actions must be a non-empty array');
    }
    for (const action of dto.actions) {
      validateActionParams(action);
    }

    const rule = await this.prisma.automationRule.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description ?? null,
        enabled: dto.enabled ?? true,
        trigger: dto.trigger,
        condition: dto.condition ?? null,
        actions: dto.actions as unknown as Prisma.InputJsonValue,
        order: dto.order ?? 0,
        createdById: userId,
      },
    });

    return toAutomationRuleDto(rule);
  }

  // ── Update rule ───────────────────────────────────────────────────────────

  async update(
    userId: string,
    ruleId: string,
    dto: UpdateAutomationRuleDto,
  ): Promise<AutomationRuleDto> {
    const existing = await this.loadRule(ruleId);
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);

    if (dto.condition !== undefined && dto.condition !== null) {
      const customFieldDefs = await this.loadCustomFieldDefs(existing.projectId);
      this.assertValidCondition(dto.condition, customFieldDefs);
    }

    if (dto.actions !== undefined) {
      if (dto.actions.length === 0) {
        throw new BadRequestException('actions must be a non-empty array');
      }
      for (const action of dto.actions) {
        validateActionParams(action);
      }
    }

    const rule = await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.trigger !== undefined ? { trigger: dto.trigger } : {}),
        ...(dto.condition !== undefined ? { condition: dto.condition } : {}),
        ...(dto.actions !== undefined
          ? { actions: dto.actions as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });

    return toAutomationRuleDto(rule);
  }

  // ── Delete rule ───────────────────────────────────────────────────────────

  async remove(userId: string, ruleId: string): Promise<{ id: string }> {
    const existing = await this.loadRule(ruleId);
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.MEMBER);
    await this.prisma.automationRule.delete({ where: { id: ruleId } });
    return { id: ruleId };
  }

  // ── List runs (project-wide) ──────────────────────────────────────────────

  async findRuns(
    userId: string,
    projectId: string,
    limit: number = 50,
  ): Promise<AutomationRunDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const cap = Math.min(Math.max(limit, 1), 200);

    const rows = await this.prisma.automationRun.findMany({
      where: { rule: { projectId } },
      include: {
        rule: { select: { name: true } },
        issue: { select: { id: true, number: true, project: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: cap,
    });

    return rows.map(toAutomationRunDto);
  }

  // ── List runs (one rule) ──────────────────────────────────────────────────

  async findRuleRuns(
    userId: string,
    ruleId: string,
    limit: number = 50,
  ): Promise<AutomationRunDto[]> {
    const rule = await this.loadRule(ruleId);
    await assertProjectMember(this.prisma, userId, rule.projectId);
    const cap = Math.min(Math.max(limit, 1), 200);

    const rows = await this.prisma.automationRun.findMany({
      where: { ruleId },
      include: {
        rule: { select: { name: true } },
        issue: { select: { id: true, number: true, project: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: cap,
    });

    return rows.map(toAutomationRunDto);
  }
}
