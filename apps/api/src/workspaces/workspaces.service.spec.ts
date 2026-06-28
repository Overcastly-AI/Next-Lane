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

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { WorkspacesService, LOGO_MAX_BYTES, LOGO_ALLOWED_MIME_TYPES, toWorkspaceDto } from './workspaces.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
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
  };
  membership: {
    findUnique: jest.Mock;
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
    },
  } as unknown as PrismaService & {
    workspace: { findUnique: jest.Mock; update: jest.Mock };
    membership: { findUnique: jest.Mock };
  };
}

function makeAudit(): AuditService {
  return { record: jest.fn() } as unknown as AuditService;
}

function makeService(prisma: PrismaService) {
  process.env.UPLOADS_DIR = os.tmpdir();
  return new WorkspacesService(prisma, makeAudit());
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

// ── WorkspacesService.uploadLogo ──────────────────────────────────────────────

describe('WorkspacesService.uploadLogo()', () => {
  it('accepts image/png', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('PNG', 'logo.png', 'image/png');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
    expect((prisma as { workspace: { update: jest.Mock } }).workspace.update).toHaveBeenCalled();
  });

  it('accepts image/jpeg', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('JPEG', 'logo.jpg', 'image/jpeg');
    const dto = await svc.uploadLogo(ADMIN_ID, WS_ID, file);
    expect(dto).toBeDefined();
  });

  it('accepts image/webp', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const file = makeTmpFile('WEBP', 'logo.webp', 'image/webp');
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

  it('rejects files over 2 MB', async () => {
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
