/**
 * DB-free unit tests for WorkspacesService — branding endpoints.
 *
 * Covers:
 *  - toWorkspaceDto mapper: brandColor and logoUrl passthrough
 *  - update(): brandColor validation (valid hex, bad string, null clears)
 *  - update(): admin-gating (non-admin member gets 403)
 *  - uploadLogo(): MIME allowlist (png/jpeg/webp accepted; svg + others rejected)
 *  - uploadLogo(): size cap (file too large rejected)
 *  - uploadLogo(): no file uploaded (400)
 *  - uploadLogo(): admin-gating
 *  - deleteLogo(): admin-gating
 *  - resolveLogo(): 404 when no logo set
 *  - resolveLogo(): returns filePath + mimeType when logo present
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { WorkspacesService, LOGO_MAX_BYTES, LOGO_ALLOWED_MIME_TYPES, toWorkspaceDto } from './workspaces.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PageTemplatesService } from '../page-templates/page-templates.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── constants ─────────────────────────────────────────────────────────────────

const WS_ID = 'ws-1';
const ADMIN_ID = 'user-admin';
const MEMBER_ID = 'user-member';
const VIEWER_ID = 'user-viewer';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeWorkspaceRow(overrides: Partial<{
  brandColor: string | null;
  logoStorageKey: string | null;
  logoMimeType: string | null;
}> = {}) {
  return {
    id: WS_ID,
    name: 'Test Workspace',
    slug: 'test-workspace',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    brandColor: overrides.brandColor ?? null,
    logoStorageKey: overrides.logoStorageKey ?? null,
    logoMimeType: overrides.logoMimeType ?? null,
  };
}

function makeMembership(role: Role, userId: string) {
  return {
    id: 'mem-1',
    role,
    userId,
    workspaceId: WS_ID,
    createdAt: new Date(),
    workspace: makeWorkspaceRow(),
  };
}

/**
 * Create a minimal PrismaService mock whose membership.findUnique returns
 * the given role for the given user IDs (ADMIN_ID → ADMIN, MEMBER_ID → MEMBER,
 * VIEWER_ID → VIEWER, anything else → null/forbidden).
 */
function makePrisma(wsOverrides: Partial<ReturnType<typeof makeWorkspaceRow>> = {}): PrismaService & {
  workspace: {
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  membership: {
    findUnique: jest.Mock;
  };
  attachment: {
    findMany: jest.Mock;
  };
} {
  const ws = { ...makeWorkspaceRow(), ...wsOverrides };

  const membershipFindUnique = jest.fn().mockImplementation(
    ({ where }: { where: { userId_workspaceId?: { userId: string }; id?: string } }) => {
      const userId = where.userId_workspaceId?.userId;
      if (userId === ADMIN_ID) return Promise.resolve(makeMembership(Role.ADMIN, ADMIN_ID));
      if (userId === MEMBER_ID) return Promise.resolve(makeMembership(Role.MEMBER, MEMBER_ID));
      if (userId === VIEWER_ID) return Promise.resolve(makeMembership(Role.VIEWER, VIEWER_ID));
      return Promise.resolve(null);
    },
  );

  return {
    membership: { findUnique: membershipFindUnique },
    workspace: {
      findUnique: jest.fn().mockResolvedValue(ws),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...ws, ...data }),
      ),
      delete: jest.fn().mockResolvedValue(ws),
    },
    attachment: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService & {
    workspace: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    membership: { findUnique: jest.Mock };
    attachment: { findMany: jest.Mock };
  };
}

function makeAudit(): AuditService {
  return { record: jest.fn() } as unknown as AuditService;
}

/**
 * Doc-template seeding is a best-effort side effect of workspace creation
 * (see WorkspacesService.create) — stubbed here so these tests stay about
 * workspaces. `seedStarters` resolving false means "already seeded", the
 * no-op branch.
 */
function makePageTemplates(): PageTemplatesService {
  return {
    seedStarters: jest.fn().mockResolvedValue(false),
  } as unknown as PageTemplatesService;
}

function makeService(prisma: PrismaService) {
  process.env.UPLOADS_DIR = os.tmpdir();
  return new WorkspacesService(prisma, makeAudit(), makePageTemplates());
}

function makeTmpFile(
  content = 'PNG_BYTES',
  name = 'logo.png',
  mimeType = 'image/png',
  size?: number,
): Express.Multer.File {
  const tmpPath = path.join(os.tmpdir(), `nl-test-logo-${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: mimeType,
    path: tmpPath,
    size: size ?? Buffer.byteLength(content),
    destination: os.tmpdir(),
    filename: path.basename(tmpPath),
    buffer: Buffer.from(content),
    stream: null as never,
  };
}

afterAll(() => {
  delete process.env.UPLOADS_DIR;
});

// ── toWorkspaceDto mapper ─────────────────────────────────────────────────────

describe('toWorkspaceDto (mapper)', () => {
  it('sets logoUrl to null when no logoStorageKey', () => {
    const dto = toWorkspaceDto(makeWorkspaceRow({ logoStorageKey: null }));
    expect(dto.logoUrl).toBeNull();
  });

  it('builds logoUrl from workspace id when logoStorageKey is set', () => {
    const dto = toWorkspaceDto(
      makeWorkspaceRow({ logoStorageKey: 'some-uuid', logoMimeType: 'image/png' }),
    );
    expect(dto.logoUrl).toBe(`/workspaces/${WS_ID}/logo`);
  });

  it('passes brandColor through as-is when set', () => {
    const dto = toWorkspaceDto(makeWorkspaceRow({ brandColor: '#1a2b3c' }));
    expect(dto.brandColor).toBe('#1a2b3c');
  });

  it('returns brandColor null when not set', () => {
    const dto = toWorkspaceDto(makeWorkspaceRow({ brandColor: null }));
    expect(dto.brandColor).toBeNull();
  });
});

// ── LOGO_ALLOWED_MIME_TYPES constant ─────────────────────────────────────────

describe('LOGO_ALLOWED_MIME_TYPES', () => {
  it('includes png, jpeg, webp', () => {
    expect(LOGO_ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
    expect(LOGO_ALLOWED_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(LOGO_ALLOWED_MIME_TYPES.has('image/webp')).toBe(true);
  });

  it('excludes svg', () => {
    expect(LOGO_ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
  });

  it('excludes other types', () => {
    expect(LOGO_ALLOWED_MIME_TYPES.has('application/pdf')).toBe(false);
    expect(LOGO_ALLOWED_MIME_TYPES.has('text/plain')).toBe(false);
  });
});

// ── WorkspacesService.update ──────────────────────────────────────────────────

describe('WorkspacesService.update()', () => {
  it('allows admin to update name', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const dto = await svc.update(ADMIN_ID, WS_ID, { name: 'New Name' });
    expect(dto.name).toBe('New Name');
    expect((prisma as { workspace: { update: jest.Mock } }).workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'New Name' }) }),
    );
  });

  it('allows admin to set a valid brandColor', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const dto = await svc.update(ADMIN_ID, WS_ID, { brandColor: '#aabbcc' });
    expect((prisma as { workspace: { update: jest.Mock } }).workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brandColor: '#aabbcc' }) }),
    );
    expect(dto).toBeDefined();
  });

  it('allows admin to clear brandColor with null', async () => {
    const prisma = makePrisma({ brandColor: '#ff0000' });
    const svc = makeService(prisma);
    await svc.update(ADMIN_ID, WS_ID, { brandColor: null });
    expect((prisma as { workspace: { update: jest.Mock } }).workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brandColor: null }) }),
    );
  });

  it('throws ForbiddenException for non-admin member', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.update(MEMBER_ID, WS_ID, { name: 'Hack' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for viewer', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.update(VIEWER_ID, WS_ID, { brandColor: '#ffffff' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws BadRequestException for empty name after trim', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.update(ADMIN_ID, WS_ID, { name: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('WorkspacesService.remove()', () => {
  it('allows an admin to delete the workspace', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const result = await svc.remove(ADMIN_ID, WS_ID);
    expect(result).toEqual({ id: WS_ID });
    expect(
      (prisma as { workspace: { delete: jest.Mock } }).workspace.delete,
    ).toHaveBeenCalledWith({ where: { id: WS_ID } });
  });

  it('collects attachment files under the workspace before deleting (no orphaned files)', async () => {
    const prisma = makePrisma();
    (
      prisma as { attachment: { findMany: jest.Mock } }
    ).attachment.findMany.mockResolvedValue([{ storageKey: 'file-1' }]);
    const svc = makeService(prisma);

    await svc.remove(ADMIN_ID, WS_ID);

    // Must query attachments scoped to this workspace's issues before cascade.
    expect(
      (prisma as { attachment: { findMany: jest.Mock } }).attachment.findMany,
    ).toHaveBeenCalledWith({
      where: { issue: { project: { workspaceId: WS_ID } } },
      select: { storageKey: true },
    });
  });

  it('throws ForbiddenException for a non-admin member', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.remove(MEMBER_ID, WS_ID)).rejects.toThrow(
      ForbiddenException,
    );
    expect(
      (prisma as { workspace: { delete: jest.Mock } }).workspace.delete,
    ).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException for a viewer', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.remove(VIEWER_ID, WS_ID)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// Real PNG magic bytes: 8-byte signature
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Real JPEG magic bytes: SOI marker (2 bytes) + JFIF/EXIF app marker prefix
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
// Real WebP magic bytes: RIFF....WEBP
const WEBP_MAGIC = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]), // file size (4 bytes, little-endian)
  Buffer.from('WEBP'),
]);

function makeTmpFileBinary(content: Buffer, name: string, mimeType: string): Express.Multer.File {
  const tmpPath = path.join(os.tmpdir(), `nl-test-logo-${Date.now()}-${Math.random()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: mimeType,
    path: tmpPath,
    size: content.length,
    destination: os.tmpdir(),
    filename: path.basename(tmpPath),
    buffer: content,
    stream: null as never,
  };
}

// ── WorkspacesService.uploadLogo ──────────────────────────────────────────────

describe('WorkspacesService.uploadLogo()', () => {
  it('accepts image/png (plain-text content, no magic bytes — file-type returns undefined → accepted)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('PNG', 'logo.png', 'image/png');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
    expect((prisma as { workspace: { update: jest.Mock } }).workspace.update).toHaveBeenCalled();
  });

  it('accepts image/jpeg (plain-text content, no magic bytes → accepted)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('JPEG', 'logo.jpg', 'image/jpeg');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
  });

  it('accepts image/webp (plain-text content, no magic bytes → accepted)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('WEBP', 'logo.webp', 'image/webp');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
  });

  // ── Magic-byte validation (item 1) ─────────────────────────────────────────

  it('accepts a real PNG file declared as image/png (magic bytes match)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    // Write a buffer with real PNG magic bytes.
    const file = makeTmpFileBinary(PNG_MAGIC, 'logo.png', 'image/png');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
  });

  it('rejects a spoofed file: declared image/png but actual content is JPEG (magic bytes mismatch)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    // JPEG magic bytes but declared as image/png → mismatch → 400.
    const file = makeTmpFileBinary(JPEG_MAGIC, 'totally-a-png.png', 'image/png');
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
  });

  it('rejects a spoofed file: declared image/png but actual content is a shell script (detected as disallowed)', async () => {
    // Real shell scripts have no magic bytes recognized by file-type → file-type returns
    // undefined → we accept the declared type. However, a file with JPEG magic bytes
    // but declared as PNG is caught. A plain text script has no magic bytes so we
    // rely on the MIME allowlist check (image/png is valid; the script declares png).
    // To confirm behavior with an explicitly disallowed detected type, use a PDF payload
    // declared as image/png: file-type detects application/pdf → not in logo allowlist → reject.
    const pdfMagic = Buffer.from('%PDF-1.5\n%\xE2\xE3');
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFileBinary(pdfMagic, 'evil.png', 'image/png');
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
  });

  it('accepts a real WebP file declared as image/webp (magic bytes match)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFileBinary(WEBP_MAGIC, 'logo.webp', 'image/webp');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
  });

  it('rejects image/svg+xml (XSS risk)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('<svg/>', 'logo.svg', 'image/svg+xml');
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, makeTmpFile('<svg/>', 'logo.svg', 'image/svg+xml'))).rejects.toThrow(
      /SVG/,
    );
  });

  it('rejects image/gif (not in allowlist)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('GIF89a', 'logo.gif', 'image/gif');
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
  });

  it('rejects application/pdf (not an image)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('%PDF', 'doc.pdf', 'application/pdf');
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
  });

  it('rejects files over the size cap', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('data', 'logo.png', 'image/png', LOGO_MAX_BYTES + 1);
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, file)).rejects.toThrow(BadRequestException);
    await expect(
      svc.uploadLogo(ADMIN_ID, WS_ID, makeTmpFile('data', 'logo.png', 'image/png', LOGO_MAX_BYTES + 1)),
    ).rejects.toThrow(/too large/);
  });

  it('rejects when no file is provided', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.uploadLogo(ADMIN_ID, WS_ID, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws ForbiddenException for non-admin (member)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('PNG', 'logo.png', 'image/png');
    await expect(svc.uploadLogo(MEMBER_ID, WS_ID, file)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException for viewer', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('PNG', 'logo.png', 'image/png');
    await expect(svc.uploadLogo(VIEWER_ID, WS_ID, file)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

// ── WorkspacesService.deleteLogo ──────────────────────────────────────────────

describe('WorkspacesService.deleteLogo()', () => {
  it('allows admin to delete the logo', async () => {
    const prisma = makePrisma({ logoStorageKey: 'uuid-key', logoMimeType: 'image/png' });
    const svc = makeService(prisma);
    const dto = await svc.deleteLogo(ADMIN_ID, WS_ID);
    expect(
      (prisma as { workspace: { update: jest.Mock } }).workspace.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { logoStorageKey: null, logoMimeType: null },
      }),
    );
    expect(dto).toBeDefined();
  });

  it('throws ForbiddenException for non-admin (member)', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.deleteLogo(MEMBER_ID, WS_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for viewer', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    await expect(svc.deleteLogo(VIEWER_ID, WS_ID)).rejects.toThrow(ForbiddenException);
  });
});

// ── WorkspacesService.resolveLogo ─────────────────────────────────────────────

describe('WorkspacesService.resolveLogo()', () => {
  it('throws NotFoundException when workspace has no logo', async () => {
    const prisma = makePrisma({ logoStorageKey: null, logoMimeType: null });
    const svc = makeService(prisma);
    await expect(svc.resolveLogo(WS_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when workspace is not found', async () => {
    const prisma = makePrisma();
    (prisma as { workspace: { findUnique: jest.Mock } }).workspace.findUnique.mockResolvedValue(null);
    const svc = makeService(prisma);
    await expect(svc.resolveLogo(WS_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns filePath and mimeType when logo file exists', async () => {
    // Write a real temp file so fs.existsSync passes.
    const tmpFile = path.join(os.tmpdir(), `nl-test-serve-logo-${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, 'PNG');
    const storageKey = path.basename(tmpFile);

    const prisma = makePrisma({ logoStorageKey: storageKey, logoMimeType: 'image/png' });
    // Override findUnique to return the right shape for resolveLogo (select query).
    (prisma as { workspace: { findUnique: jest.Mock } }).workspace.findUnique.mockResolvedValue({
      logoStorageKey: storageKey,
      logoMimeType: 'image/png',
    });

    const svc = makeService(prisma);
    const { filePath, mimeType } = await svc.resolveLogo(WS_ID);

    expect(mimeType).toBe('image/png');
    expect(filePath).toBe(path.join(os.tmpdir(), storageKey));

    fs.unlinkSync(tmpFile);
  });

  it('is callable without auth context (public route)', async () => {
    // resolveLogo takes no userId — the service does NOT call assertWorkspaceMember.
    // This verifies the method signature is truly auth-free.
    const prisma = makePrisma({ logoStorageKey: null, logoMimeType: null });
    const svc = makeService(prisma);
    // Even an "anonymous" call with no userId works (it simply throws 404 for no logo).
    await expect(svc.resolveLogo(WS_ID)).rejects.toThrow(NotFoundException);
    // membership.findUnique should never have been called.
    expect(
      (prisma as { membership: { findUnique: jest.Mock } }).membership.findUnique,
    ).not.toHaveBeenCalled();
  });
});

// ── create(): slug-collision retry ───────────────────────────────────────────

describe('WorkspacesService.create — concurrent slug collision', () => {
  const { Prisma } = jest.requireActual('@prisma/client') as typeof import('@prisma/client');

  function p2002(): Error {
    return new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }

  function makeCreatePrisma(createImpl: jest.Mock) {
    return {
      // uniqueSlug probe: slug always looks free (that's the race).
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: createImpl,
      },
    } as unknown as PrismaService;
  }

  it('retries with a fresh suffix when the winning insert takes the slug (P2002)', async () => {
    const created = { ...makeWorkspaceRow(), slug: 'alpha-retry' };
    const create = jest
      .fn()
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce(created);
    const svc = makeService(makeCreatePrisma(create));

    const dto = await svc.create(ADMIN_ID, { name: 'Alpha' });

    expect(create).toHaveBeenCalledTimes(2);
    // Second attempt must NOT reuse the first (taken) slug.
    const firstSlug = (create.mock.calls[0][0] as { data: { slug: string } }).data.slug;
    const secondSlug = (create.mock.calls[1][0] as { data: { slug: string } }).data.slug;
    expect(secondSlug).not.toBe(firstSlug);
    expect(dto.slug).toBe('alpha-retry');
  });

  it('gives up after bounded retries and surfaces the error', async () => {
    const create = jest.fn().mockRejectedValue(p2002());
    const svc = makeService(makeCreatePrisma(create));

    await expect(svc.create(ADMIN_ID, { name: 'Alpha' })).rejects.toThrow('unique constraint');
    expect(create.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('does not retry non-P2002 errors', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const svc = makeService(makeCreatePrisma(create));

    await expect(svc.create(ADMIN_ID, { name: 'Alpha' })).rejects.toThrow('db down');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addMember / updateMemberRole / removeMember — SETTINGS-1 (admin-lockout fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// A dedicated in-memory membership mock (distinct from `makePrisma()` above,
// which only models a single fixed membership per known user id) so we can
// exercise multi-membership scenarios: the "already a member" 409, the
// last-admin guard on demote/remove, and that a non-last-admin demote still
// succeeds.

interface MockUser {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
}

interface MockMembership {
  id: string;
  userId: string;
  workspaceId: string;
  role: Role;
  user: MockUser;
  createdAt: Date;
}

function makeMockUser(id: string, email: string): MockUser {
  return {
    id,
    email,
    name: email,
    avatarColor: '#123456',
    emailNotifications: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeMembersPrisma(
  seed: MockMembership[],
  extraUsers: MockUser[] = [],
): PrismaService & {
  membership: {
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  user: { findUnique: jest.Mock };
} {
  const memberships: MockMembership[] = [...seed];
  let nextId = memberships.length + 1;
  // Users that exist in the system but may not yet have a membership in this
  // workspace — needed so `create()` can attach the right user to a
  // brand-new membership row (addMember's "new invite" happy path).
  const userDirectory = new Map<string, MockUser>(
    [...memberships.map((m) => m.user), ...extraUsers].map((u) => [u.id, u]),
  );

  const findUnique = jest.fn().mockImplementation(
    ({
      where,
    }: {
      where: { userId_workspaceId?: { userId: string; workspaceId: string }; id?: string };
    }) => {
      if (where.userId_workspaceId) {
        const { userId, workspaceId } = where.userId_workspaceId;
        const found = memberships.find(
          (m) => m.userId === userId && m.workspaceId === workspaceId,
        );
        return Promise.resolve(found ? { ...found, workspace: {} } : null);
      }
      if (where.id) {
        const found = memberships.find((m) => m.id === where.id);
        return Promise.resolve(found ?? null);
      }
      return Promise.resolve(null);
    },
  );

  const count = jest.fn().mockImplementation(
    ({
      where,
    }: {
      where: { workspaceId: string; role?: Role; id?: { not?: string } };
    }) => {
      const n = memberships.filter((m) => {
        if (m.workspaceId !== where.workspaceId) return false;
        if (where.role && m.role !== where.role) return false;
        if (where.id?.not && m.id === where.id.not) return false;
        return true;
      }).length;
      return Promise.resolve(n);
    },
  );

  const create = jest.fn().mockImplementation(
    ({
      data,
    }: {
      data: { userId: string; workspaceId: string; role: Role };
    }) => {
      const user = userDirectory.get(data.userId);
      const row: MockMembership = {
        id: `mem-new-${nextId++}`,
        userId: data.userId,
        workspaceId: data.workspaceId,
        role: data.role,
        user: user ?? makeMockUser(data.userId, `${data.userId}@example.com`),
        createdAt: new Date(),
      };
      memberships.push(row);
      return Promise.resolve(row);
    },
  );

  const update = jest.fn().mockImplementation(
    ({ where, data }: { where: { id: string }; data: { role: Role } }) => {
      const row = memberships.find((m) => m.id === where.id);
      if (!row) throw new Error('membership not found in mock');
      row.role = data.role;
      return Promise.resolve(row);
    },
  );

  const del = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const idx = memberships.findIndex((m) => m.id === where.id);
    if (idx >= 0) memberships.splice(idx, 1);
    return Promise.resolve({});
  });

  const userFindUnique = jest.fn().mockImplementation(
    ({ where }: { where: { email: string } }) => {
      const found = [...userDirectory.values()].find((u) => u.email === where.email);
      return Promise.resolve(found ?? null);
    },
  );

  return {
    membership: { findUnique, count, create, update, delete: del },
    user: { findUnique: userFindUnique },
  } as unknown as PrismaService & {
    membership: {
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };
}

describe('WorkspacesService.addMember() — existing-member invite (SETTINGS-1a)', () => {
  const WS = 'ws-members';

  it('rejects (409) inviting an email that already belongs to a member of the workspace', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    await expect(
      svc.addMember(admin.id, WS, { email: admin.email, role: Role.MEMBER }),
    ).rejects.toThrow(ConflictException);
    // No upsert-demote: role change never happens via addMember.
    expect(prisma.membership.update).not.toHaveBeenCalled();
  });

  it('creates a new membership when the email has no existing membership in this workspace', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const newUser = makeMockUser('u-new', 'new@example.com');
    const prisma = makeMembersPrisma(
      [
        { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
      ],
      // newUser exists as a user in the system but has no membership in this
      // workspace yet — the case addMember should still allow.
      [newUser],
    );

    const svc = makeService(prisma);
    const result = await svc.addMember(admin.id, WS, {
      email: newUser.email,
      role: Role.VIEWER,
    });

    expect(result.role).toBe(Role.VIEWER);
    expect(result.user.email).toBe(newUser.email);
  });
});

describe('WorkspacesService.updateMemberRole() — last-admin guard (SETTINGS-1b/c)', () => {
  const WS = 'ws-members';

  it('rejects (400) demoting the sole admin', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    await expect(
      svc.updateMemberRole(admin.id, WS, 'mem-admin', { role: Role.MEMBER }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects (400) a sole admin demoting THEMSELVES specifically (self-demotion path)', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    // Actor === the membership being demoted, and it's the last admin.
    await expect(
      svc.updateMemberRole(admin.id, WS, 'mem-admin', { role: Role.VIEWER }),
    ).rejects.toThrow(/at least one admin/i);
  });

  it('allows demoting an admin when another admin remains (non-last-admin demote still works)', async () => {
    const admin1 = makeMockUser('u-admin1', 'admin1@example.com');
    const admin2 = makeMockUser('u-admin2', 'admin2@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin1', userId: admin1.id, workspaceId: WS, role: Role.ADMIN, user: admin1, createdAt: new Date() },
      { id: 'mem-admin2', userId: admin2.id, workspaceId: WS, role: Role.ADMIN, user: admin2, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    const result = await svc.updateMemberRole(admin1.id, WS, 'mem-admin2', {
      role: Role.MEMBER,
    });

    expect(result.role).toBe(Role.MEMBER);
  });

  it('allows changing a non-admin member role freely (no guard triggered)', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const member = makeMockUser('u-member', 'member@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
      { id: 'mem-member', userId: member.id, workspaceId: WS, role: Role.MEMBER, user: member, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    const result = await svc.updateMemberRole(admin.id, WS, 'mem-member', {
      role: Role.VIEWER,
    });

    expect(result.role).toBe(Role.VIEWER);
  });
});

describe('WorkspacesService.removeMember() — last-admin guard (SETTINGS-1b/c)', () => {
  const WS = 'ws-members';

  it('rejects (400) removing the sole admin', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    await expect(svc.removeMember(admin.id, WS, 'mem-admin')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('rejects (400) the sole admin removing THEMSELVES specifically (self-removal path)', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    await expect(
      svc.removeMember(admin.id, WS, 'mem-admin'),
    ).rejects.toThrow(/at least one admin/i);
  });

  it('allows removing an admin when another admin remains', async () => {
    const admin1 = makeMockUser('u-admin1', 'admin1@example.com');
    const admin2 = makeMockUser('u-admin2', 'admin2@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin1', userId: admin1.id, workspaceId: WS, role: Role.ADMIN, user: admin1, createdAt: new Date() },
      { id: 'mem-admin2', userId: admin2.id, workspaceId: WS, role: Role.ADMIN, user: admin2, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    const result = await svc.removeMember(admin1.id, WS, 'mem-admin2');
    expect(result).toEqual({ id: 'mem-admin2' });
    expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: 'mem-admin2' } });
  });

  it('allows removing a non-admin member with no guard involved', async () => {
    const admin = makeMockUser('u-admin', 'admin@example.com');
    const member = makeMockUser('u-member', 'member@example.com');
    const prisma = makeMembersPrisma([
      { id: 'mem-admin', userId: admin.id, workspaceId: WS, role: Role.ADMIN, user: admin, createdAt: new Date() },
      { id: 'mem-member', userId: member.id, workspaceId: WS, role: Role.MEMBER, user: member, createdAt: new Date() },
    ]);
    const svc = makeService(prisma);

    const result = await svc.removeMember(admin.id, WS, 'mem-member');
    expect(result).toEqual({ id: 'mem-member' });
  });
});
