import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@next-lane/shared';
import * as shared from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { SavedFiltersService, toSavedFilterDto } from './saved-filters.service';
import type { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const WORKSPACE_ID = 'ws-1';
const OWNER_ID = 'user-owner';
const OTHER_ID = 'user-other';
const FILTER_ID = 'filter-abc';

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

interface SavedFilterRow {
  id: string;
  name: string;
  query: string;
  ownerId: string;
  projectId: string | null;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function makeFilterRow(overrides: Partial<SavedFilterRow> = {}): SavedFilterRow {
  return {
    id: FILTER_ID,
    name: 'My Filter',
    query: 'status = DONE',
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    isShared: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeProjectRow() {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    workspace: { id: WORKSPACE_ID },
    archived: false,
  };
}

// ---------------------------------------------------------------------------
// Prisma mock builder
// ---------------------------------------------------------------------------

function makePrisma(opts: {
  existingFilter?: SavedFilterRow | null;
  listRows?: SavedFilterRow[];
  customFieldDefs?: Array<{ id: string; key: string; name: string; type: string }>;
} = {}) {
  const existingFilter = opts.existingFilter !== undefined ? opts.existingFilter : null;
  const listRows = opts.listRows ?? [];
  const customFieldDefs = opts.customFieldDefs ?? [];

  return {
    project: {
      findUnique: jest.fn().mockResolvedValue(makeProjectRow()),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ role: Role.MEMBER }),
    },
    customFieldDefinition: {
      findMany: jest.fn().mockResolvedValue(customFieldDefs),
    },
    savedFilter: {
      findMany: jest.fn().mockResolvedValue(listRows),
      findUnique: jest.fn().mockResolvedValue(existingFilter),
      create: jest.fn().mockImplementation(({ data }: { data: Partial<SavedFilterRow> }) =>
        Promise.resolve(makeFilterRow({ ...data })),
      ),
      update: jest.fn().mockImplementation(
        ({ data }: { where: { id: string }; data: Partial<SavedFilterRow> }) =>
          Promise.resolve(makeFilterRow({ ...data })),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// toSavedFilterDto mapper
// ---------------------------------------------------------------------------

describe('toSavedFilterDto', () => {
  it('maps isShared to shared and converts dates to ISO strings', () => {
    const row = makeFilterRow({ isShared: true });
    const dto = toSavedFilterDto(row);
    expect(dto.shared).toBe(true);
    expect(dto.id).toBe(FILTER_ID);
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps projectId as null when null', () => {
    const row = makeFilterRow({ projectId: null });
    const dto = toSavedFilterDto(row);
    expect(dto.projectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SavedFiltersService.findAll
// ---------------------------------------------------------------------------

describe('SavedFiltersService.findAll', () => {
  beforeEach(() => {
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue(makeProjectRow() as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue(makeProjectRow() as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns own filters plus shared filters ordered by name', async () => {
    const ownFilter = makeFilterRow({ id: 'f1', name: 'A Filter', ownerId: OWNER_ID, isShared: false });
    const sharedFilter = makeFilterRow({ id: 'f2', name: 'B Filter', ownerId: OTHER_ID, isShared: true });
    const prisma = makePrisma({ listRows: [ownFilter, sharedFilter] });
    const svc = new SavedFiltersService(prisma);

    const result = await svc.findAll(OWNER_ID, PROJECT_ID);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('f1');
    expect(result[1].id).toBe('f2');
  });

  it('does NOT return other users private filters (query uses OR ownerId/isShared)', async () => {
    // The mock returns whatever is in listRows; we verify the WHERE passed to Prisma.
    const prisma = makePrisma({ listRows: [] });
    const svc = new SavedFiltersService(prisma);

    await svc.findAll(OWNER_ID, PROJECT_ID);

    const call = (prisma.savedFilter.findMany as jest.Mock).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    // Must scope to projectId and filter with OR [ownerId, isShared]
    expect(call.where).toMatchObject({
      projectId: PROJECT_ID,
      OR: [{ ownerId: OWNER_ID }, { isShared: true }],
    });
  });

  it('calls assertProjectMember for access control', async () => {
    const prisma = makePrisma({ listRows: [] });
    const svc = new SavedFiltersService(prisma);

    await svc.findAll(OWNER_ID, PROJECT_ID);

    expect(membership.assertProjectMember).toHaveBeenCalledWith(
      prisma,
      OWNER_ID,
      PROJECT_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// SavedFiltersService.create
// ---------------------------------------------------------------------------

describe('SavedFiltersService.create', () => {
  beforeEach(() => {
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue(makeProjectRow() as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue(makeProjectRow() as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates a filter when query is valid', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const prisma = makePrisma();
    const svc = new SavedFiltersService(prisma);

    const result = await svc.create(OWNER_ID, PROJECT_ID, {
      name: 'My Filter',
      query: 'status = DONE',
    });

    expect(result.name).toBe('My Filter');
    expect(prisma.savedFilter.create).toHaveBeenCalled();
  });

  it('rejects an invalid NLQL query with BadRequestException', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({
      ok: false,
      error: { message: 'Unknown field', position: 0 },
    });
    const prisma = makePrisma();
    const svc = new SavedFiltersService(prisma);

    await expect(
      svc.create(OWNER_ID, PROJECT_ID, {
        name: 'Bad',
        query: 'notafield = foo',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.savedFilter.create).not.toHaveBeenCalled();
  });

  it('calls assertProjectRole with MEMBER minimum', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const prisma = makePrisma();
    const svc = new SavedFiltersService(prisma);

    await svc.create(OWNER_ID, PROJECT_ID, { name: 'X', query: 'status = TODO' });

    expect(membership.assertProjectRole).toHaveBeenCalledWith(
      prisma,
      OWNER_ID,
      PROJECT_ID,
      Role.MEMBER,
    );
  });

  it('stores isShared=false by default', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const prisma = makePrisma();
    const svc = new SavedFiltersService(prisma);

    await svc.create(OWNER_ID, PROJECT_ID, { name: 'X', query: 'status = TODO' });

    const createData = (prisma.savedFilter.create as jest.Mock).mock.calls[0][0].data;
    expect(createData.isShared).toBe(false);
  });

  it('stores isShared=true when shared=true is provided', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const prisma = makePrisma();
    const svc = new SavedFiltersService(prisma);

    await svc.create(OWNER_ID, PROJECT_ID, { name: 'X', query: 'status = TODO', shared: true });

    const createData = (prisma.savedFilter.create as jest.Mock).mock.calls[0][0].data;
    expect(createData.isShared).toBe(true);
  });

  it('loads custom field defs and passes them to validateQuery', async () => {
    const validateSpy = jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const customFieldDefs = [
      { id: 'cf-1', key: 'severity', name: 'Severity', type: 'SELECT' },
    ];
    const prisma = makePrisma({ customFieldDefs });
    const svc = new SavedFiltersService(prisma);

    await svc.create(OWNER_ID, PROJECT_ID, { name: 'X', query: 'severity = High' });

    expect(validateSpy).toHaveBeenCalledWith(
      'severity = High',
      expect.objectContaining({
        customFieldDefs: expect.arrayContaining([
          expect.objectContaining({ key: 'severity' }),
        ]),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// SavedFiltersService.update
// ---------------------------------------------------------------------------

describe('SavedFiltersService.update', () => {
  beforeEach(() => {
    jest
      .spyOn(membership, 'assertProjectMember')
      .mockResolvedValue(makeProjectRow() as never);
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue(makeProjectRow() as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('allows owner to update name', async () => {
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await svc.update(OWNER_ID, FILTER_ID, { name: 'Renamed' });

    const updateData = (prisma.savedFilter.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.name).toBe('Renamed');
  });

  it('throws ForbiddenException when non-owner tries to update', async () => {
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await expect(svc.update(OTHER_ID, FILTER_ID, { name: 'X' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.savedFilter.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when filter does not exist', async () => {
    const prisma = makePrisma({ existingFilter: null });
    const svc = new SavedFiltersService(prisma);

    await expect(svc.update(OWNER_ID, 'no-such-id', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('re-validates query when query is updated', async () => {
    const validateSpy = jest.spyOn(shared, 'validateQuery').mockReturnValue({ ok: true });
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await svc.update(OWNER_ID, FILTER_ID, { query: 'priority = HIGH' });

    expect(validateSpy).toHaveBeenCalled();
  });

  it('rejects invalid query on update with BadRequestException', async () => {
    jest.spyOn(shared, 'validateQuery').mockReturnValue({
      ok: false,
      error: { message: 'bad field', position: 0 },
    });
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await expect(
      svc.update(OWNER_ID, FILTER_ID, { query: 'bad = stuff' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.savedFilter.update).not.toHaveBeenCalled();
  });

  it('does NOT call validateQuery when query is not in the patch', async () => {
    const validateSpy = jest.spyOn(shared, 'validateQuery');
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await svc.update(OWNER_ID, FILTER_ID, { name: 'New Name' });

    expect(validateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SavedFiltersService.remove
// ---------------------------------------------------------------------------

describe('SavedFiltersService.remove', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows owner to delete their filter', async () => {
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    const result = await svc.remove(OWNER_ID, FILTER_ID);

    expect(result).toEqual({ id: FILTER_ID });
    expect(prisma.savedFilter.delete).toHaveBeenCalledWith({ where: { id: FILTER_ID } });
  });

  it('throws ForbiddenException when non-owner tries to delete', async () => {
    const filter = makeFilterRow({ ownerId: OWNER_ID });
    const prisma = makePrisma({ existingFilter: filter });
    const svc = new SavedFiltersService(prisma);

    await expect(svc.remove(OTHER_ID, FILTER_ID)).rejects.toThrow(ForbiddenException);
    expect(prisma.savedFilter.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when filter does not exist', async () => {
    const prisma = makePrisma({ existingFilter: null });
    const svc = new SavedFiltersService(prisma);

    await expect(svc.remove(OWNER_ID, 'no-such-id')).rejects.toThrow(NotFoundException);
  });
});
