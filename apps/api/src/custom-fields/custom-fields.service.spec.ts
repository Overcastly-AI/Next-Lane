import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomFieldType, IssueType, Role } from '@next-lane/shared';
import {
  CustomFieldsService,
  slugifyName,
} from './custom-fields.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CustomFieldValue } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const USER_ID = 'user-owner';
const VIEWER_ID = 'user-viewer';
const FIELD_ID = 'cf-abc';

// ---------------------------------------------------------------------------
// Minimal Prisma mock builder
// ---------------------------------------------------------------------------

interface DefinitionRow {
  id: string;
  projectId: string;
  name: string;
  key: string;
  type: string;
  options: string[];
  appliesToTypes: string[];
  required: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

function makeDefinitionRow(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    id: FIELD_ID,
    projectId: PROJECT_ID,
    name: 'Severity',
    key: 'severity',
    type: CustomFieldType.SELECT,
    options: ['Low', 'Medium', 'High'],
    appliesToTypes: [],
    required: false,
    order: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makePrisma(opts: {
  userRole?: Role | null;
  existingKeys?: string[];
  definitions?: DefinitionRow[];
  existingRows?: DefinitionRow[];
} = {}) {
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.MEMBER;
  const definitions = opts.definitions ?? [];
  const existingRows = opts.existingRows ?? [];

  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        id: PROJECT_ID,
        workspaceId: 'ws-1',
        workspace: { id: 'ws-1' },
      }),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { userId_workspaceId: { userId: string } } }) => {
          const { userId } = where.userId_workspaceId;
          if (userId === VIEWER_ID) return Promise.resolve({ role: Role.VIEWER });
          if (userRole === null) return Promise.resolve(null);
          return Promise.resolve({ role: userRole });
        },
      ),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockImplementation(
        (args?: { where?: { projectId?: string; key?: { startsWith?: string } } }) => {
          if (args?.where?.key?.startsWith !== undefined) {
            // resolveUniqueKey call
            const base = args.where.key.startsWith;
            const keysToReturn = (opts.existingKeys ?? []).filter((k) =>
              k.startsWith(base),
            );
            return Promise.resolve(keysToReturn.map((k) => ({ key: k })));
          }
          // validateAndNormalize or findAll call
          return Promise.resolve(definitions);
        },
      ),
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) => {
          const row = existingRows.find((r) => r.id === where.id);
          return Promise.resolve(row ?? null);
        },
      ),
      findFirst: jest.fn().mockResolvedValue(null), // no existing → order=0
      create: jest.fn().mockImplementation(({ data }: { data: DefinitionRow }) =>
        Promise.resolve({ ...makeDefinitionRow(), ...data, id: 'new-cf-id' }),
      ),
      update: jest.fn().mockImplementation(
        ({ where, data }: { where: { id: string }; data: Partial<DefinitionRow> }) => {
          const row = existingRows.find((r) => r.id === where.id) ?? makeDefinitionRow();
          return Promise.resolve({ ...row, ...data });
        },
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// slugifyName
// ---------------------------------------------------------------------------

describe('slugifyName', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(slugifyName('My Field')).toBe('my_field');
  });

  it('collapses multiple non-alnum chars into one underscore', () => {
    expect(slugifyName('Hello   World!!!')).toBe('hello_world');
  });

  it('strips leading and trailing underscores', () => {
    expect(slugifyName('  !!test!!')).toBe('test');
  });

  it('preserves existing snake_case', () => {
    expect(slugifyName('severity_level')).toBe('severity_level');
  });

  it('falls back to "field" for a name that slugifies to empty', () => {
    expect(slugifyName('!!!---')).toBe('field');
  });

  it('handles numeric-only names', () => {
    expect(slugifyName('123')).toBe('123');
  });
});

// ---------------------------------------------------------------------------
// CustomFieldsService.create — key slug / uniqueness
// ---------------------------------------------------------------------------

describe('CustomFieldsService.create — key slug and uniqueness', () => {
  it('derives the key from the name on first create', async () => {
    const prisma = makePrisma({ existingKeys: [] });
    const svc = new CustomFieldsService(prisma);
    await svc.create(USER_ID, PROJECT_ID, {
      name: 'My Field',
      type: CustomFieldType.TEXT,
    });
    const callData = (prisma.customFieldDefinition.create as jest.Mock).mock.calls[0][0].data;
    expect(callData.key).toBe('my_field');
  });

  it('appends _2 when the base key already exists', async () => {
    const prisma = makePrisma({ existingKeys: ['my_field'] });
    const svc = new CustomFieldsService(prisma);
    await svc.create(USER_ID, PROJECT_ID, {
      name: 'My Field',
      type: CustomFieldType.TEXT,
    });
    const callData = (prisma.customFieldDefinition.create as jest.Mock).mock.calls[0][0].data;
    expect(callData.key).toBe('my_field_2');
  });

  it('appends _3 when _2 also exists', async () => {
    const prisma = makePrisma({ existingKeys: ['my_field', 'my_field_2'] });
    const svc = new CustomFieldsService(prisma);
    await svc.create(USER_ID, PROJECT_ID, {
      name: 'My Field',
      type: CustomFieldType.TEXT,
    });
    const callData = (prisma.customFieldDefinition.create as jest.Mock).mock.calls[0][0].data;
    expect(callData.key).toBe('my_field_3');
  });

  it('rejects SELECT without options', async () => {
    const prisma = makePrisma();
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.create(USER_ID, PROJECT_ID, {
        name: 'Status',
        type: CustomFieldType.SELECT,
        options: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects MULTI_SELECT without options', async () => {
    const prisma = makePrisma();
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.create(USER_ID, PROJECT_ID, {
        name: 'Tags',
        type: CustomFieldType.MULTI_SELECT,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects TEXT with non-empty options', async () => {
    const prisma = makePrisma();
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.create(USER_ID, PROJECT_ID, {
        name: 'Note',
        type: CustomFieldType.TEXT,
        options: ['a', 'b'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts SELECT with non-empty options', async () => {
    const prisma = makePrisma({ existingKeys: [] });
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.create(USER_ID, PROJECT_ID, {
        name: 'Priority',
        type: CustomFieldType.SELECT,
        options: ['Low', 'High'],
      }),
    ).resolves.toBeDefined();
  });

  it('rejects VIEWER role on create', async () => {
    const prisma = makePrisma({ userRole: Role.VIEWER });
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.create(VIEWER_ID, PROJECT_ID, {
        name: 'Test',
        type: CustomFieldType.TEXT,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// CustomFieldsService.update — type/key immutability
// ---------------------------------------------------------------------------

describe('CustomFieldsService.update', () => {
  const existingDef = makeDefinitionRow({
    type: CustomFieldType.SELECT,
    options: ['Low', 'High'],
  });

  it('allows updating name', async () => {
    const prisma = makePrisma({ existingRows: [existingDef] });
    const svc = new CustomFieldsService(prisma);
    const result = await svc.update(USER_ID, FIELD_ID, { name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('rejects SELECT with empty options on update', async () => {
    const prisma = makePrisma({ existingRows: [existingDef] });
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.update(USER_ID, FIELD_ID, { options: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects update if field not found', async () => {
    const prisma = makePrisma({ existingRows: [] });
    const svc = new CustomFieldsService(prisma);
    await expect(
      svc.update(USER_ID, 'nonexistent', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows updating appliesToTypes', async () => {
    const prisma = makePrisma({ existingRows: [existingDef] });
    const svc = new CustomFieldsService(prisma);
    const result = await svc.update(USER_ID, FIELD_ID, {
      appliesToTypes: [IssueType.BUG],
    });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CustomFieldsService.remove
// ---------------------------------------------------------------------------

describe('CustomFieldsService.remove', () => {
  it('deletes the definition and returns its id', async () => {
    const prisma = makePrisma({ existingRows: [makeDefinitionRow()] });
    const svc = new CustomFieldsService(prisma);
    const result = await svc.remove(USER_ID, FIELD_ID);
    expect(result).toEqual({ id: FIELD_ID });
    expect(prisma.customFieldDefinition.delete).toHaveBeenCalledWith({
      where: { id: FIELD_ID },
    });
  });

  it('throws NotFoundException for unknown id', async () => {
    const prisma = makePrisma({ existingRows: [] });
    const svc = new CustomFieldsService(prisma);
    await expect(svc.remove(USER_ID, 'nope')).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// CustomFieldsService.validateAndNormalize
// ---------------------------------------------------------------------------

describe('CustomFieldsService.validateAndNormalize', () => {
  function makeServiceWithDefs(defs: DefinitionRow[]) {
    const prisma = makePrisma({ definitions: defs });
    return new CustomFieldsService(prisma);
  }

  // ── Happy paths ──────────────────────────────────────────────────────────

  it('returns empty object for empty payload', async () => {
    const svc = makeServiceWithDefs([]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {});
    expect(result).toEqual({});
  });

  it('accepts a valid TEXT value', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.TEXT, options: [] });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: 'some text',
    });
    expect(result[FIELD_ID]).toBe('some text');
  });

  it('accepts a valid NUMBER value', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.NUMBER, options: [] });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: 42,
    });
    expect(result[FIELD_ID]).toBe(42);
  });

  it('accepts a valid CHECKBOX value', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.CHECKBOX, options: [] });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: true,
    });
    expect(result[FIELD_ID]).toBe(true);
  });

  it('accepts a valid DATE value', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.DATE, options: [] });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: '2024-06-15',
    });
    expect(result[FIELD_ID]).toBe('2024-06-15');
  });

  it('accepts a valid SELECT value', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.SELECT,
      options: ['Low', 'Medium', 'High'],
    });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: 'Medium',
    });
    expect(result[FIELD_ID]).toBe('Medium');
  });

  it('accepts a valid MULTI_SELECT value', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.MULTI_SELECT,
      options: ['A', 'B', 'C'],
    });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: ['A', 'C'],
    });
    expect(result[FIELD_ID]).toEqual(['A', 'C']);
  });

  it('accepts null to clear a field', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.TEXT, options: [] });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
      [FIELD_ID]: null,
    });
    expect(result[FIELD_ID]).toBeNull();
  });

  // ── Failure modes ────────────────────────────────────────────────────────

  it('throws BadRequestException for unknown field id', async () => {
    const svc = makeServiceWithDefs([]); // no definitions
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        'unknown-id': 'value',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when field does not apply to issue type', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.TEXT,
      options: [],
      appliesToTypes: [IssueType.BUG], // only BUG
    });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'hello',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows field when issue type matches appliesToTypes', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.TEXT,
      options: [],
      appliesToTypes: [IssueType.BUG],
    });
    const svc = makeServiceWithDefs([def]);
    const result = await svc.validateAndNormalize(PROJECT_ID, IssueType.BUG, {
      [FIELD_ID]: 'hello',
    });
    expect(result[FIELD_ID]).toBe('hello');
  });

  it('throws BadRequestException for TEXT field receiving a number', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.TEXT, options: [] });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 123 as unknown as CustomFieldValue,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for NUMBER field receiving a string', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.NUMBER, options: [] });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'not-a-number' as unknown as CustomFieldValue,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for CHECKBOX receiving a string', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.CHECKBOX, options: [] });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'yes' as unknown as CustomFieldValue,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for DATE field with invalid string', async () => {
    const def = makeDefinitionRow({ type: CustomFieldType.DATE, options: [] });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'not-a-date',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for SELECT with value not in options', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.SELECT,
      options: ['Low', 'High'],
    });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'Critical',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for MULTI_SELECT with an invalid option', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.MULTI_SELECT,
      options: ['A', 'B', 'C'],
    });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: ['A', 'Z'], // Z is not in options
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for SELECT receiving a non-string', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.SELECT,
      options: ['Low', 'High'],
    });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 1 as unknown as CustomFieldValue,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for MULTI_SELECT receiving a non-array', async () => {
    const def = makeDefinitionRow({
      type: CustomFieldType.MULTI_SELECT,
      options: ['A', 'B'],
    });
    const svc = makeServiceWithDefs([def]);
    await expect(
      svc.validateAndNormalize(PROJECT_ID, IssueType.TASK, {
        [FIELD_ID]: 'A' as unknown as CustomFieldValue,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Merge-on-update semantics (tested via validateAndNormalize + merge logic)
// This mirrors what IssuesService.update does: validate → merge → write.
// ---------------------------------------------------------------------------

describe('Custom field merge-on-update semantics', () => {
  /**
   * Simulate the MERGE that IssuesService.update performs:
   *   start from `existing`, apply validated `incoming`, remove null keys.
   */
  async function simulateMerge(
    existing: Record<string, CustomFieldValue>,
    incoming: Record<string, CustomFieldValue>,
    defs: DefinitionRow[],
  ): Promise<Record<string, CustomFieldValue>> {
    const prisma = makePrisma({ definitions: defs });
    const svc = new CustomFieldsService(prisma);
    const normalized = await svc.validateAndNormalize(
      PROJECT_ID,
      IssueType.TASK,
      incoming,
    );
    const merged: Record<string, CustomFieldValue> = { ...existing };
    for (const [k, v] of Object.entries(normalized)) {
      if (v === null) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    return merged;
  }

  const textDef = makeDefinitionRow({
    id: 'cf-text',
    key: 'notes',
    type: CustomFieldType.TEXT,
    options: [],
  });
  const numDef = makeDefinitionRow({
    id: 'cf-num',
    key: 'score',
    type: CustomFieldType.NUMBER,
    options: [],
  });

  it('leaves untouched keys when only some keys are in the patch', async () => {
    const existing: Record<string, CustomFieldValue> = {
      'cf-text': 'keep me',
      'cf-num': 10,
    };
    const result = await simulateMerge(
      existing,
      { 'cf-num': 20 }, // only update score
      [textDef, numDef],
    );
    expect(result['cf-text']).toBe('keep me'); // untouched
    expect(result['cf-num']).toBe(20);
  });

  it('removes a key when null is provided', async () => {
    const existing: Record<string, CustomFieldValue> = {
      'cf-text': 'hello',
      'cf-num': 5,
    };
    const result = await simulateMerge(
      existing,
      { 'cf-text': null },
      [textDef, numDef],
    );
    expect('cf-text' in result).toBe(false);
    expect(result['cf-num']).toBe(5); // untouched
  });

  it('adds a new key that was previously absent', async () => {
    const existing: Record<string, CustomFieldValue> = { 'cf-num': 1 };
    const result = await simulateMerge(
      existing,
      { 'cf-text': 'new value' },
      [textDef, numDef],
    );
    expect(result['cf-text']).toBe('new value');
    expect(result['cf-num']).toBe(1); // untouched
  });

  it('handles empty incoming patch (no changes)', async () => {
    const existing: Record<string, CustomFieldValue> = { 'cf-text': 'stable' };
    const result = await simulateMerge(existing, {}, [textDef]);
    expect(result).toEqual({ 'cf-text': 'stable' });
  });
});
