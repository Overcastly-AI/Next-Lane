/**
 * Unit tests for AutomationsService.
 * Tests: CRUD mapping, NLQL validation rejection, action param validation.
 * PrismaService is mocked so no DB is needed.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AutomationsService, validateActionParams } from './automations.service';
import { AutomationTrigger, AutomationActionType, AutomationRunStatus, Priority, Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const PROJECT_ID = 'proj-1';
const RULE_ID = 'rule-1';
const WORKSPACE_ID = 'ws-1';

function makePrisma() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        workspace: { id: WORKSPACE_ID },
      }),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: Role.ADMIN }),
    },
    automationRule: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    automationRun: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

function makeService(prisma: MockPrisma): AutomationsService {
  return new AutomationsService(prisma as unknown as PrismaService);
}

const VALID_ACTION = {
  type: AutomationActionType.SET_PRIORITY,
  params: { priority: Priority.HIGH },
};

const BASE_CREATE_DTO = {
  name: 'Test Rule',
  trigger: AutomationTrigger.ISSUE_CREATED,
  actions: [VALID_ACTION],
};

const BASE_RULE_ROW = {
  id: RULE_ID,
  projectId: PROJECT_ID,
  name: 'Test Rule',
  description: null,
  enabled: true,
  trigger: AutomationTrigger.ISSUE_CREATED,
  condition: null,
  actions: [VALID_ACTION],
  order: 0,
  createdById: USER_ID,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// ---------------------------------------------------------------------------
// validateActionParams unit tests
// ---------------------------------------------------------------------------

describe('validateActionParams', () => {
  it('accepts ASSIGN with string assigneeId', () => {
    expect(() =>
      validateActionParams({ type: AutomationActionType.ASSIGN, params: { assigneeId: 'user-1' } }),
    ).not.toThrow();
  });

  it('accepts ASSIGN with null assigneeId (unassign)', () => {
    expect(() =>
      validateActionParams({ type: AutomationActionType.ASSIGN, params: { assigneeId: null } }),
    ).not.toThrow();
  });

  it('rejects SET_PRIORITY with invalid priority', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.SET_PRIORITY,
        params: { priority: 'SuperHigh' },
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts SET_PRIORITY with valid priority', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.SET_PRIORITY,
        params: { priority: Priority.HIGHEST },
      }),
    ).not.toThrow();
  });

  it('rejects TRANSITION without statusId', () => {
    expect(() =>
      validateActionParams({ type: AutomationActionType.TRANSITION, params: {} }),
    ).toThrow(BadRequestException);
  });

  it('rejects ADD_LABEL without labelId', () => {
    expect(() =>
      validateActionParams({ type: AutomationActionType.ADD_LABEL, params: {} }),
    ).toThrow(BadRequestException);
  });

  it('rejects ADD_COMMENT with empty body', () => {
    expect(() =>
      validateActionParams({ type: AutomationActionType.ADD_COMMENT, params: { body: '   ' } }),
    ).toThrow(BadRequestException);
  });

  it('accepts ADD_COMMENT with non-empty body', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.ADD_COMMENT,
        params: { body: 'hello' },
      }),
    ).not.toThrow();
  });

  it('rejects SET_CUSTOM_FIELD without fieldId', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.SET_CUSTOM_FIELD,
        params: { value: 'x' },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects SET_CUSTOM_FIELD without value', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.SET_CUSTOM_FIELD,
        params: { fieldId: 'f1' },
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts SET_CUSTOM_FIELD with fieldId and value', () => {
    expect(() =>
      validateActionParams({
        type: AutomationActionType.SET_CUSTOM_FIELD,
        params: { fieldId: 'f1', value: 42 },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AutomationsService CRUD
// ---------------------------------------------------------------------------

describe('AutomationsService', () => {
  let prisma: MockPrisma;
  let service: AutomationsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = makeService(prisma);
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns mapped rules ordered by order asc', async () => {
      const rows = [
        { ...BASE_RULE_ROW, order: 1 },
        { ...BASE_RULE_ROW, id: 'rule-2', order: 0 },
      ];
      prisma.automationRule.findMany.mockResolvedValue(rows);

      const result = await service.findAll(USER_ID, PROJECT_ID);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(RULE_ID);
      expect(result[0].trigger).toBe(AutomationTrigger.ISSUE_CREATED);
      expect(result[0].actions).toEqual([VALID_ACTION]);
      expect(result[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('throws when user is not a project member', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);
      await expect(service.findAll(USER_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a rule and returns its DTO', async () => {
      prisma.automationRule.create.mockResolvedValue(BASE_RULE_ROW);

      const result = await service.create(USER_ID, PROJECT_ID, BASE_CREATE_DTO);
      expect(result.id).toBe(RULE_ID);
      expect(result.trigger).toBe(AutomationTrigger.ISSUE_CREATED);
      expect(prisma.automationRule.create).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid NLQL condition with 400', async () => {
      await expect(
        service.create(USER_ID, PROJECT_ID, {
          ...BASE_CREATE_DTO,
          condition: '!!!invalid query',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty actions array with 400', async () => {
      await expect(
        service.create(USER_ID, PROJECT_ID, {
          ...BASE_CREATE_DTO,
          actions: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid action params with 400', async () => {
      await expect(
        service.create(USER_ID, PROJECT_ID, {
          ...BASE_CREATE_DTO,
          actions: [{ type: AutomationActionType.SET_PRIORITY, params: { priority: 'BadValue' } }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts null condition (unconditional rule)', async () => {
      prisma.automationRule.create.mockResolvedValue({ ...BASE_RULE_ROW, condition: null });
      const result = await service.create(USER_ID, PROJECT_ID, {
        ...BASE_CREATE_DTO,
        condition: null,
      });
      expect(result.condition).toBeNull();
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    beforeEach(() => {
      prisma.automationRule.findUnique.mockResolvedValue(BASE_RULE_ROW);
      prisma.automationRule.update.mockResolvedValue(BASE_RULE_ROW);
    });

    it('updates and returns the rule DTO', async () => {
      const result = await service.update(USER_ID, RULE_ID, { name: 'Updated' });
      expect(prisma.automationRule.update).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(RULE_ID);
    });

    it('rejects invalid NLQL condition with 400', async () => {
      await expect(
        service.update(USER_ID, RULE_ID, { condition: '!!bad' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty actions array with 400', async () => {
      await expect(
        service.update(USER_ID, RULE_ID, { actions: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when rule not found', async () => {
      prisma.automationRule.findUnique.mockResolvedValue(null);
      await expect(service.update(USER_ID, RULE_ID, { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the rule', async () => {
      prisma.automationRule.findUnique.mockResolvedValue(BASE_RULE_ROW);
      prisma.automationRule.delete.mockResolvedValue(BASE_RULE_ROW);

      const result = await service.remove(USER_ID, RULE_ID);
      expect(result).toEqual({ id: RULE_ID });
      expect(prisma.automationRule.delete).toHaveBeenCalledWith({ where: { id: RULE_ID } });
    });

    it('throws 404 when rule not found', async () => {
      prisma.automationRule.findUnique.mockResolvedValue(null);
      await expect(service.remove(USER_ID, RULE_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── findRuns ───────────────────────────────────────────────────────────────

  describe('findRuns', () => {
    it('returns mapped run DTOs', async () => {
      const runRow = {
        id: 'run-1',
        ruleId: RULE_ID,
        issueId: 'issue-1',
        trigger: AutomationTrigger.ISSUE_CREATED,
        matched: true,
        status: AutomationRunStatus.SUCCESS,
        actionsApplied: [{ type: 'SET_PRIORITY', detail: 'priority set to High' }],
        error: null,
        createdAt: new Date('2026-01-01'),
        rule: { name: 'Test Rule' },
        issue: { id: 'issue-1', number: 1, project: { key: 'NL' } },
      };
      prisma.automationRun.findMany.mockResolvedValue([runRow]);

      const result = await service.findRuns(USER_ID, PROJECT_ID, 50);
      expect(result).toHaveLength(1);
      expect(result[0].ruleName).toBe('Test Rule');
      expect(result[0].issueKey).toBe('NL-1');
      expect(result[0].status).toBe(AutomationRunStatus.SUCCESS);
    });
  });
});
