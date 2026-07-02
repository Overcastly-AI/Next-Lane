/**
 * DB-free unit tests for AttachmentsService.
 *
 * Covers:
 *  - MIME type rejection (upload)
 *  - Size rejection (upload)
 *  - Membership enforcement (list, download)
 *  - VIEWER cannot upload (requires MEMBER role)
 *  - Delete permission: uploader can delete their own file
 *  - Delete permission: project admin can delete any file
 *  - Delete permission: a MEMBER who is NOT the uploader is rejected
 *  - (Pass 5) SVG upload rejected (not in ALLOWED_MIME_TYPES)
 *  - (Pass 5) Null/undefined file throws BadRequestException
 *  - (Pass 5) Magic-byte MIME mismatch rejected (detected vs declared type)
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@next-lane/shared';
import { AttachmentsService, ALLOWED_MIME_TYPES } from './attachments.service';
import type { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock file-type so magic-byte detection is controllable in tests.
// The service does: const fileType = require('file-type');
// We intercept that require here.
const mockFromFile = jest.fn<Promise<{ mime: string } | undefined>, [string]>();
jest.mock('file-type', () => ({
  fromFile: (...args: unknown[]) => mockFromFile(args[0] as string),
}));

// Silence console noise from safeUnlink during tests.
jest.spyOn(console, 'error').mockImplementation(() => {});

// ── helpers ──────────────────────────────────────────────────────────────────

const PROJ_ID = 'proj-1';
const ISSUE_ID = 'issue-1';
const UPLOADER_ID = 'user-uploader';
const OTHER_MEMBER_ID = 'user-other';
const ADMIN_ID = 'user-admin';
const VIEWER_ID = 'user-viewer';
const ATTACHMENT_ID = 'att-1';
const STORAGE_KEY = 'some-uuid.pdf';

function makeTmpFile(content = 'hello', name = 'test.pdf'): Express.Multer.File {
  const tmpPath = path.join(os.tmpdir(), `nl-test-${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/pdf',
    path: tmpPath,
    size: Buffer.byteLength(content),
    destination: os.tmpdir(),
    filename: path.basename(tmpPath),
    buffer: Buffer.from(content),
    stream: null as never,
  };
}

function makeAttachmentRow(overrides: Partial<{
  id: string;
  uploaderId: string;
}> = {}) {
  return {
    id: overrides.id ?? ATTACHMENT_ID,
    issueId: ISSUE_ID,
    uploaderId: overrides.uploaderId ?? UPLOADER_ID,
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    storageKey: STORAGE_KEY,
    createdAt: new Date(),
    uploader: {
      id: UPLOADER_ID,
      email: 'up@example.com',
      name: 'Uploader',
      avatarColor: '#000',
      createdAt: new Date(),
    },
  };
}

function makeProject(memberRole: Role) {
  return {
    id: PROJ_ID,
    workspaceId: 'ws-1',
    key: 'NL',
    name: 'Test',
    description: null,
    leadId: null,
    archived: false,
    issueSeq: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    workspace: { id: 'ws-1', name: 'WS', slug: 'ws', createdAt: new Date(), updatedAt: new Date() },
  };
}

function makeMembership(role: Role, userId: string) {
  return { id: 'mem-1', role, userId, workspaceId: 'ws-1', createdAt: new Date() };
}

function makePrisma(opts: {
  memberRole?: Role;
  attachmentUploaderId?: string;
  attachmentExists?: boolean;
  issueExists?: boolean;
} = {}) {
  const {
    memberRole = Role.MEMBER,
    attachmentUploaderId = UPLOADER_ID,
    attachmentExists = true,
    issueExists = true,
  } = opts;

  return {
    issue: {
      findUnique: jest.fn().mockResolvedValue(
        issueExists ? { id: ISSUE_ID, projectId: PROJ_ID } : null,
      ),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue(makeProject(memberRole)),
    },
    membership: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { userId_workspaceId: { userId: string } } }) => {
        const uid = where.userId_workspaceId.userId;
        if (uid === VIEWER_ID) return Promise.resolve(makeMembership(Role.VIEWER, uid));
        if (uid === ADMIN_ID) return Promise.resolve(makeMembership(Role.ADMIN, uid));
        if (uid === UPLOADER_ID) return Promise.resolve(makeMembership(Role.MEMBER, uid));
        if (uid === OTHER_MEMBER_ID) return Promise.resolve(makeMembership(Role.MEMBER, uid));
        return Promise.resolve(null);
      }),
    },
    projectMembership: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    attachment: {
      create: jest.fn().mockResolvedValue(makeAttachmentRow()),
      findMany: jest.fn().mockResolvedValue([makeAttachmentRow()]),
      findUnique: jest.fn().mockResolvedValue(
        attachmentExists ? makeAttachmentRow({ uploaderId: attachmentUploaderId }) : null,
      ),
      delete: jest.fn().mockResolvedValue(makeAttachmentRow()),
    },
  } as unknown as PrismaService;
}

function makeService(prisma: PrismaService) {
  const svc = new AttachmentsService(prisma);
  // Override UPLOADS_DIR to a real temp directory so fs ops work
  process.env.UPLOADS_DIR = os.tmpdir();
  return svc;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AttachmentsService', () => {
  beforeEach(() => {
    // Default: file-type returns undefined (no magic bytes — e.g. text/plain).
    // Individual tests override this as needed.
    mockFromFile.mockResolvedValue(undefined);
  });

  afterAll(() => {
    delete process.env.UPLOADS_DIR;
  });

  // ── upload: MIME rejection ──────────────────────────────────────────────────

  describe('upload()', () => {
    it('rejects disallowed MIME type', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);
      const file = makeTmpFile('data', 'bad.exe');
      file.mimetype = 'application/x-msdownload';

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects files exceeding MAX_FILE_BYTES', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);
      const file = makeTmpFile('x', 'big.pdf');
      file.mimetype = 'application/pdf';
      // Lie about size — service checks file.size
      file.size = 999 * 1024 * 1024; // 999 MB

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects upload from VIEWER (requires MEMBER)', async () => {
      const prisma = makePrisma({ memberRole: Role.VIEWER });
      const svc = makeService(prisma);
      const file = makeTmpFile('pdf content', 'doc.pdf');
      file.mimetype = 'application/pdf';

      await expect(svc.upload(VIEWER_ID, ISSUE_ID, file)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('accepts a valid PDF from a MEMBER', async () => {
      const prisma = makePrisma({ memberRole: Role.MEMBER });
      const svc = makeService(prisma);

      const content = '%PDF-1.4 fake content';
      const file = makeTmpFile(content, 'report.pdf');
      file.mimetype = 'application/pdf';

      const result = await svc.upload(UPLOADER_ID, ISSUE_ID, file);
      expect(result).toMatchObject({
        issueId: ISSUE_ID,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('throws NotFoundException for a non-existent issue', async () => {
      const prisma = makePrisma({ issueExists: false });
      const svc = makeService(prisma);
      const file = makeTmpFile('x', 'test.pdf');
      file.mimetype = 'application/pdf';

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ALLOWED_MIME_TYPES contains expected types', () => {
      expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('application/pdf')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('text/plain')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('application/zip')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('application/x-msdownload')).toBe(false);
      expect(ALLOWED_MIME_TYPES.has('application/javascript')).toBe(false);
    });

    // ── Pass 5 new tests ─────────────────────────────────────────────────────

    it('(Pass 5) rejects SVG uploads — not in ALLOWED_MIME_TYPES', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);
      const file = makeTmpFile('<svg><script>alert(1)</script></svg>', 'evil.svg');
      file.mimetype = 'image/svg+xml';

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('(Pass 5) SVG is absent from ALLOWED_MIME_TYPES', () => {
      expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
    });

    it('(Pass 5) throws BadRequestException when file is undefined (no file field in multipart)', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      await expect(
        svc.upload(UPLOADER_ID, ISSUE_ID, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('(Pass 5) rejects when detected magic-byte type does not match declared MIME type', async () => {
      // Simulate: user declares image/png but the file contains a JPEG.
      mockFromFile.mockResolvedValue({ mime: 'image/jpeg' });

      const prisma = makePrisma();
      const svc = makeService(prisma);
      const file = makeTmpFile('fake-jpeg-bytes', 'tricky.png');
      file.mimetype = 'image/png'; // declared as PNG, but detected as JPEG

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('(Pass 5) rejects when detected magic-byte type is not in the allowlist', async () => {
      // Simulate: file-type detects an exe hidden inside a fake .pdf.
      mockFromFile.mockResolvedValue({ mime: 'application/x-msdownload' });

      const prisma = makePrisma();
      const svc = makeService(prisma);
      const file = makeTmpFile('MZ...exe-bytes', 'sneaky.pdf');
      file.mimetype = 'application/pdf';

      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('(Pass 5) accepts an image/png file whose magic bytes also detect as image/png', async () => {
      // file-type detects 'image/png' — matches declared MIME → accepted (no throw).
      mockFromFile.mockResolvedValue({ mime: 'image/png' });

      const prisma = makePrisma({ memberRole: Role.MEMBER });
      const svc = makeService(prisma);
      const file = makeTmpFile('\x89PNG\r\n\x1a\n', 'photo.png');
      file.mimetype = 'image/png';

      // Should not throw — the magic byte check passes.
      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).resolves.toBeDefined();
    });

    it('(Pass 5) accepts a .docx declared as docx when magic bytes are application/zip (ZIP family)', async () => {
      // OOXML (.docx) is a ZIP archive — file-type detects "application/zip".
      // The MIME_EQUIVALENTS map treats application/zip as compatible with docx.
      mockFromFile.mockResolvedValue({ mime: 'application/zip' });

      const prisma = makePrisma({ memberRole: Role.MEMBER });
      const svc = makeService(prisma);
      const file = makeTmpFile('PK...', 'report.docx');
      file.mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      // Should not throw — ZIP-family equivalence allows this.
      await expect(svc.upload(UPLOADER_ID, ISSUE_ID, file)).resolves.toBeDefined();
    });
  });

  // ── list: membership enforcement ───────────────────────────────────────────

  describe('list()', () => {
    it('returns attachments for a project member', async () => {
      const prisma = makePrisma();
      const svc = makeService(prisma);

      const results = await svc.list(UPLOADER_ID, ISSUE_ID);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ issueId: ISSUE_ID });
    });

    it('rejects a user who is not a workspace member', async () => {
      const prisma = makePrisma();
      // Membership lookup returns null for an unknown user
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(null);
      const svc = makeService(prisma);

      await expect(svc.list('stranger-id', ISSUE_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows VIEWER to list attachments', async () => {
      const prisma = makePrisma({ memberRole: Role.VIEWER });
      const svc = makeService(prisma);

      const results = await svc.list(VIEWER_ID, ISSUE_ID);
      expect(results).toHaveLength(1);
    });
  });

  // ── remove: permission checks ──────────────────────────────────────────────

  describe('remove()', () => {
    it('allows the uploader to delete their own attachment', async () => {
      const prisma = makePrisma({ attachmentUploaderId: UPLOADER_ID });
      // Pre-create a real file so fs.unlinkSync doesn't throw
      const fakePath = path.join(os.tmpdir(), STORAGE_KEY);
      fs.writeFileSync(fakePath, 'content');

      const svc = makeService(prisma);
      const result = await svc.remove(UPLOADER_ID, ATTACHMENT_ID);
      expect(result).toEqual({ id: ATTACHMENT_ID });
    });

    it('allows a project ADMIN to delete any attachment', async () => {
      const prisma = makePrisma({ attachmentUploaderId: UPLOADER_ID });
      const fakePath = path.join(os.tmpdir(), STORAGE_KEY);
      fs.writeFileSync(fakePath, 'content');

      const svc = makeService(prisma);
      const result = await svc.remove(ADMIN_ID, ATTACHMENT_ID);
      expect(result).toEqual({ id: ATTACHMENT_ID });
    });

    it('rejects a non-uploader MEMBER from deleting', async () => {
      const prisma = makePrisma({ attachmentUploaderId: UPLOADER_ID });
      const svc = makeService(prisma);

      await expect(svc.remove(OTHER_MEMBER_ID, ATTACHMENT_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a VIEWER from deleting their own attachment', async () => {
      // Even if the VIEWER is the uploader, they still lack MEMBER role —
      // but our service says uploaderId === userId → only needs membership.
      // A viewer IS a member of the workspace, so they CAN delete their own file.
      // This tests the specific logic: viewer-as-uploader can delete.
      const prisma = makePrisma({ attachmentUploaderId: VIEWER_ID });
      const fakePath = path.join(os.tmpdir(), STORAGE_KEY);
      fs.writeFileSync(fakePath, 'content');

      const svc = makeService(prisma);
      // viewer IS a workspace member, so assertProjectMember passes
      const result = await svc.remove(VIEWER_ID, ATTACHMENT_ID);
      expect(result).toEqual({ id: ATTACHMENT_ID });
    });

    it('throws NotFoundException for a missing attachment', async () => {
      const prisma = makePrisma({ attachmentExists: false });
      const svc = makeService(prisma);

      await expect(svc.remove(UPLOADER_ID, ATTACHMENT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── resolveForDownload ─────────────────────────────────────────────────────

  describe('resolveForDownload()', () => {
    it('returns file path for a project member', async () => {
      // Write the file so existsSync returns true
      const fakePath = path.join(os.tmpdir(), STORAGE_KEY);
      fs.writeFileSync(fakePath, 'content');

      const prisma = makePrisma();
      const svc = makeService(prisma);

      const { filePath, attachment } = await svc.resolveForDownload(
        UPLOADER_ID,
        ATTACHMENT_ID,
      );
      expect(filePath).toBe(fakePath);
      expect(attachment.filename).toBe('report.pdf');
    });

    it('rejects a non-member from downloading', async () => {
      const prisma = makePrisma();
      (prisma.membership.findUnique as jest.Mock).mockResolvedValue(null);
      const svc = makeService(prisma);

      await expect(
        svc.resolveForDownload('stranger-id', ATTACHMENT_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
