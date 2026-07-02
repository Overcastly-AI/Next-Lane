/**
 * Unit tests for IssueTemplatesService.
 * Prisma and IssuesService are mocked — no real DB or NestJS bootstrap needed.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IssueType, Priority, Role } from '@next-lane/shared';
import { IssueTemplatesService } from './issue-templates.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { IssuesService } from '../issues/issues.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-1';
const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const TEMPLATE_ID = 'tmpl-abc';
const USER_ADMIN = 'user-admin';
const USER_MEMBER = 'user-member';
const USER_VIEWER = 'user-viewer';
const USER_FOREIGN = 'user-foreign';
const ASSIGNEE_ID = 'user-assignee';
const COMPONENT_ID = 'comp-1';
const LABEL_ID_A = 'label-a';
const LABEL_ID_B = 'label-b';
const ISSUE_ID = 'issue-xyz';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTemplate = {
  id: TEMPLATE_ID,
  projectId: PROJECT_ID,
  name: 'Bug report',
  issueType: IssueType.BUG,
  titleTemplate: '[BUG] ',
  descriptionTemplate: '## Steps to reproduce\n',
  priority: Priority.HIGH,
  defaultAssigneeId: null,
  defaultAssignee: null,
  componentId: null,
  labelIds: [LABEL_ID_A],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const baseProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  workspace: { id: WORKSPACE_ID },
};

const baseIssueDto = {
  id: ISSUE_ID,
  key: 'PROJ-1',
  number: 1,
  projectId: PROJECT_ID,
  type: IssueType.BUG,
  title: '[BUG] My title',
  description: null,
  statusId: 'status-1',
  assigneeId: null,
  reporterId: USER_MEMBER,
  priority: Priority.HIGH,
  storyPoints: null,
  parentId: null,
  sprintId: null,
  dueDate: null,
  rank: 'a0',
  labels: [],
  componentId: null,
  originalEstimateMinutes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------

function makePrisma(opts: {
  templateProjectId?: string;
  userRole?: Role | null;
  assigneeMember?: boolean;
  componentProjectId?: string;
  labelProjectIds?: Record<string, string>;
  prismaErrorCode?: string;
} = {}) {
  const templateProjectId = opts.templateProjectId ?? PROJECT_ID;
  const userRole = opts.userRole !== undefined ? opts.userRole : Role.ADMIN;
  const assigneeMember = opts.assigneeMember !== false;
  const componentProjectId = opts.componentProjectId ?? PROJECT_ID;
  const labelProjectIds: Record<string, string> = opts.labelProjectIds ?? {
    [LABEL_ID_A]: PROJECT_ID,
    [LABEL_ID_B]: PROJECT_ID,
  };
  const prismaErrorCode = opts.prismaErrorCode;

  const prisma = {
    issueTemplate: {
      findMany: jest.fn().mockResolvedValue([
        { ...baseTemplate, projectId: templateProjectId },
      ]),
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === TEMPLATE_ID) {
            return Promise.resolve({
              ...baseTemplate,
              projectId: templateProjectId,
            });
          }
          return Promise.resolve(null);
        },
      ),
      create: jest.fn().mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          if (prismaErrorCode) {
            const err = Object.assign(new Error('unique violation'), {
              code: prismaErrorCode,
            });
            return Promise.reject(err);
          }
          return Promise.resolve({
            ...baseTemplate,
            name: data.name ?? baseTemplate.name,
            issueType: data.issueType ?? baseTemplate.issueType,
            titleTemplate: data.titleTemplate ?? null,
            descriptionTemplate: data.descriptionTemplate ?? null,
            priority: data.priority ?? null,
            defaultAssigneeId: data.defaultAssigneeId ?? null,
            defaultAssignee: null,
            componentId: data.componentId ?? null,
            labelIds: data.labelIds ?? [],
          });
        },
      ),
      update: jest.fn().mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          if (prismaErrorCode) {
            const err = Object.assign(new Error('unique violation'), {
              code: prismaErrorCode,
            });
            return Promise.reject(err);
          }
          return Promise.resolve({
            ...baseTemplate,
            name: data.name ?? baseTemplate.name,
            defaultAssignee: null,
          });
        },
      ),
      delete: jest.fn().mockResolvedValue(baseTemplate),
    },
    project: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === PROJECT_ID) {
            return Promise.resolve(baseProject);
          }
          if (where.id === OTHER_PROJECT_ID) {
            return Promise.resolve({
              id: OTHER_PROJECT_ID,
              workspaceId: 'ws-2',
              workspace: { id: 'ws-2' },
            });
          }
          return Promise.resolve(null);
        },
      ),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(
        ({
          where,
        }: {
          where: { userId_workspaceId: { userId: string; workspaceId: string } };
        }) => {
          const { userId, workspaceId } = where.userId_workspaceId;
          if (userId === ASSIGNEE_ID) {
            return assigneeMember
              ? Promise.resolve({ role: Role.MEMBER })
              : Promise.resolve(null);
          }
          if (userId === USER_FOREIGN) return Promise.resolve(null);
          if (workspaceId === 'ws-2') return Promise.resolve(null);
          if (userRole === null) return Promise.resolve(null);
          if (userId === USER_VIEWER) return Promise.resolve({ role: Role.VIEWER });
          if (userId === USER_MEMBER) return Promise.resolve({ role: Role.MEMBER });
          return Promise.resolve({ role: userRole });
        },
      ),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    component: {
      findUnique: jest.fn().mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === COMPONENT_ID) {
            return Promise.resolve({ projectId: componentProjectId });
          }
          return Promise.resolve(null);
        },
      ),
    },
    label: {
      findMany: jest.fn().mockImplementation(
        ({ where }: { where: { id: { in: string[] }; projectId: string } }) => {
          const ids: string[] = where.id.in;
          const projectId: string = where.projectId;
          const matches = ids.filter(
            (id) => labelProjectIds[id] === projectId,
          );
          return Promise.resolve(matches.map((id) => ({ id })));
        },
      ),
    },
    issueLabel: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  return prisma as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// IssuesService mock
// ---------------------------------------------------------------------------

function makeIssuesService(opts: {
  issueDto?: typeof baseIssueDto;
} = {}): IssuesService {
  const issueDto = opts.issueDto ?? baseIssueDto;
  return {
    create: jest.fn().mockResolvedValue(issueDto),
    findOne: jest.fn().mockResolvedValue({ ...issueDto, comments: [], activities: [] }),
  } as unknown as IssuesService;
}

// ---------------------------------------------------------------------------
// Helper: build service with mocks
// ---------------------------------------------------------------------------

function makeService(
  prismaOpts: Parameters<typeof makePrisma>[0] = {},
  issuesSvcOpts: Parameters<typeof makeIssuesService>[0] = {},
) {
  return new IssueTemplatesService(
    makePrisma(prismaOpts),
    makeIssuesService(issuesSvcOpts),
  );
}

// ===========================================================================
// findAll
// ===========================================================================
describe('IssueTemplatesService.findAll', () => {
  it('returns templates for a project member', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    const result = await svc.findAll(USER_MEMBER, PROJECT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(TEMPLATE_ID);
    expect(result[0].name).toBe('Bug report');
    expect(result[0].labelIds).toEqual([LABEL_ID_A]);
  });

  it('returns templates for a VIEWER', async () => {
    const svc = makeService({ userRole: Role.VIEWER });
    const result = await svc.findAll(USER_VIEWER, PROJECT_ID);
    expect(result).toHaveLength(1);
  });

  it('rejects a non-member (ForbiddenException)', async () => {
    const svc = makeService({ userRole: null });
    await expect(svc.findAll(USER_FOREIGN, PROJECT_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ===========================================================================
// create
// ===========================================================================
describe('IssueTemplatesService.create', () => {
  it('creates a template as ADMIN', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    const result = await svc.create(USER_ADMIN, PROJECT_ID, {
      name: 'Feature request',
    });
    expect(result.name).toBe('Feature request');
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.defaultAssignee).toBeNull();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    await expect(
      svc.create(USER_MEMBER, PROJECT_ID, { name: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects VIEWER with ForbiddenException', async () => {
    const svc = makeService({ userRole: Role.VIEWER });
    await expect(
      svc.create(USER_VIEWER, PROJECT_ID, { name: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const svc = makeService({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' });
    await expect(
      svc.create(USER_ADMIN, PROJECT_ID, { name: 'Bug report' }),
    ).rejects.toThrow(ConflictException);
  });

  it('accepts a valid defaultAssigneeId (workspace member)', async () => {
    const svc = makeService({ userRole: Role.ADMIN, assigneeMember: true });
    const result = await svc.create(USER_ADMIN, PROJECT_ID, {
      name: 'With assignee',
      defaultAssigneeId: ASSIGNEE_ID,
    });
    expect(result).toBeDefined();
  });

  it('rejects defaultAssigneeId that is not in the workspace (BadRequestException)', async () => {
    const svc = makeService({ userRole: Role.ADMIN, assigneeMember: false });
    await expect(
      svc.create(USER_ADMIN, PROJECT_ID, {
        name: 'With bad assignee',
        defaultAssigneeId: ASSIGNEE_ID,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts null defaultAssigneeId', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    const result = await svc.create(USER_ADMIN, PROJECT_ID, {
      name: 'Null assignee',
      defaultAssigneeId: null,
    });
    expect(result).toBeDefined();
  });

  it('accepts a valid componentId belonging to the project', async () => {
    const svc = makeService({
      userRole: Role.ADMIN,
      componentProjectId: PROJECT_ID,
    });
    const result = await svc.create(USER_ADMIN, PROJECT_ID, {
      name: 'With component',
      componentId: COMPONENT_ID,
    });
    expect(result).toBeDefined();
  });

  it('rejects a componentId from another project (BadRequestException)', async () => {
    const svc = makeService({
      userRole: Role.ADMIN,
      componentProjectId: OTHER_PROJECT_ID,
    });
    await expect(
      svc.create(USER_ADMIN, PROJECT_ID, {
        name: 'Bad component',
        componentId: COMPONENT_ID,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts valid labelIds belonging to the project', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    const result = await svc.create(USER_ADMIN, PROJECT_ID, {
      name: 'With labels',
      labelIds: [LABEL_ID_A, LABEL_ID_B],
    });
    expect(result).toBeDefined();
  });

  it('rejects labelIds from another project (BadRequestException)', async () => {
    const svc = makeService({
      userRole: Role.ADMIN,
      labelProjectIds: { [LABEL_ID_A]: OTHER_PROJECT_ID },
    });
    await expect(
      svc.create(USER_ADMIN, PROJECT_ID, {
        name: 'Bad labels',
        labelIds: [LABEL_ID_A],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ===========================================================================
// update
// ===========================================================================
describe('IssueTemplatesService.update', () => {
  it('renames a template as ADMIN', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    const result = await svc.update(USER_ADMIN, TEMPLATE_ID, { name: 'Renamed' });
    expect(result).toBeDefined();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    await expect(
      svc.update(USER_MEMBER, TEMPLATE_ID, { name: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown template id', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    await expect(
      svc.update(USER_ADMIN, 'does-not-exist', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate name with ConflictException (P2002)', async () => {
    const svc = makeService({ userRole: Role.ADMIN, prismaErrorCode: 'P2002' });
    await expect(
      svc.update(USER_ADMIN, TEMPLATE_ID, { name: 'Duplicate' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects defaultAssigneeId not in workspace (BadRequestException)', async () => {
    const svc = makeService({ userRole: Role.ADMIN, assigneeMember: false });
    await expect(
      svc.update(USER_ADMIN, TEMPLATE_ID, { defaultAssigneeId: ASSIGNEE_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a cross-project componentId (BadRequestException)', async () => {
    const svc = makeService({
      userRole: Role.ADMIN,
      componentProjectId: OTHER_PROJECT_ID,
    });
    await expect(
      svc.update(USER_ADMIN, TEMPLATE_ID, { componentId: COMPONENT_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects labelIds from another project (BadRequestException)', async () => {
    const svc = makeService({
      userRole: Role.ADMIN,
      labelProjectIds: { [LABEL_ID_A]: OTHER_PROJECT_ID },
    });
    await expect(
      svc.update(USER_ADMIN, TEMPLATE_ID, { labelIds: [LABEL_ID_A] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('tenant isolation: rejects update on a foreign-project template (ForbiddenException)', async () => {
    // Template belongs to OTHER_PROJECT_ID which is in ws-2; caller has no
    // membership in ws-2.
    const svc = makeService({
      templateProjectId: OTHER_PROJECT_ID,
      userRole: Role.ADMIN,
    });
    await expect(
      svc.update(USER_ADMIN, TEMPLATE_ID, { name: 'Hack' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ===========================================================================
// remove
// ===========================================================================
describe('IssueTemplatesService.remove', () => {
  it('deletes a template as ADMIN', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    await expect(svc.remove(USER_ADMIN, TEMPLATE_ID)).resolves.toBeUndefined();
  });

  it('rejects MEMBER with ForbiddenException', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    await expect(svc.remove(USER_MEMBER, TEMPLATE_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws NotFoundException for unknown template id', async () => {
    const svc = makeService({ userRole: Role.ADMIN });
    await expect(svc.remove(USER_ADMIN, 'does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('tenant isolation: rejects delete on a foreign-project template (ForbiddenException)', async () => {
    const svc = makeService({
      templateProjectId: OTHER_PROJECT_ID,
      userRole: Role.ADMIN,
    });
    await expect(svc.remove(USER_ADMIN, TEMPLATE_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ===========================================================================
// createFromTemplate
// ===========================================================================
describe('IssueTemplatesService.createFromTemplate', () => {
  it('creates an issue using template defaults', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    const result = await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {});
    expect(result.id).toBe(ISSUE_ID);
  });

  it('passes titleTemplate as title when no override provided', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {});

    const createCall = (issuesSvc.create as jest.Mock).mock.calls[0][1];
    expect(createCall.title).toBe('[BUG] ');
  });

  it('override title beats titleTemplate', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {
      title: 'My custom title',
    });

    const createCall = (issuesSvc.create as jest.Mock).mock.calls[0][1];
    expect(createCall.title).toBe('My custom title');
  });

  it('throws BadRequestException when title and titleTemplate are both empty', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    // Override findUnique to return a template without titleTemplate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.issueTemplate as unknown as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      ...baseTemplate,
      titleTemplate: null,
    });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await expect(
      svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('calls IssuesService.create with the merged payload', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {
      assigneeId: USER_ADMIN,
      priority: Priority.HIGHEST,
    });

    const createCall = (issuesSvc.create as jest.Mock).mock.calls[0][1];
    expect(createCall.assigneeId).toBe(USER_ADMIN);
    expect(createCall.priority).toBe(Priority.HIGHEST);
    expect(createCall.type).toBe(IssueType.BUG);
    expect(createCall.projectId).toBe(PROJECT_ID);
  });

  it('attaches template labelIds to the created issue', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsertMock = (prisma.issueLabel as unknown as { upsert: jest.Mock }).upsert;
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId_labelId: { issueId: ISSUE_ID, labelId: LABEL_ID_A } },
      }),
    );
  });

  it('dto.labelIds override replaces template labelIds', async () => {
    const issuesSvc = makeIssuesService();
    const prisma = makePrisma({ userRole: Role.MEMBER });
    const svc = new IssueTemplatesService(prisma, issuesSvc);

    await svc.createFromTemplate(USER_MEMBER, TEMPLATE_ID, {
      labelIds: [LABEL_ID_B],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upsertMock = (prisma.issueLabel as unknown as { upsert: jest.Mock }).upsert;
    // Only LABEL_ID_B should be attached (not LABEL_ID_A from the template)
    const calls = upsertMock.mock.calls.map(
      (c: [{ where: { issueId_labelId: { labelId: string } } }]) =>
        c[0].where.issueId_labelId.labelId,
    );
    expect(calls).toContain(LABEL_ID_B);
    expect(calls).not.toContain(LABEL_ID_A);
  });

  it('throws NotFoundException for unknown template id', async () => {
    const svc = makeService({ userRole: Role.MEMBER });
    await expect(
      svc.createFromTemplate(USER_MEMBER, 'does-not-exist', {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects non-member with ForbiddenException', async () => {
    const svc = makeService({ userRole: null });
    await expect(
      svc.createFromTemplate(USER_FOREIGN, TEMPLATE_ID, { title: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
