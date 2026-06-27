import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import type { AttachmentDto } from '@next-lane/shared';

/** Default upload directory; override with UPLOADS_DIR env var. */
export const DEFAULT_UPLOADS_DIR = './uploads';

/** Max file size in bytes (default 10 MB). Override with MAX_FILE_BYTES env. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Allowed MIME types for uploaded files.
 * Covers images, PDF, plain text, office docs, archives.
 */
export const ALLOWED_MIME_TYPES = new Set<string>([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // PDF
  'application/pdf',
  // Plain text / code
  'text/plain',
  'text/markdown',
  'text/csv',
  // Office documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Archives
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-zip-compressed',
]);

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;
}

function getMaxBytes(): number {
  const v = process.env.MAX_FILE_BYTES;
  return v ? parseInt(v, 10) : DEFAULT_MAX_BYTES;
}

function toDto(
  a: {
    id: string;
    issueId: string;
    uploaderId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    uploader: {
      id: string;
      email: string;
      name: string;
      avatarColor: string;
      createdAt: Date;
    };
  },
): AttachmentDto {
  return {
    id: a.id,
    issueId: a.issueId,
    uploaderId: a.uploaderId,
    uploader: toUserDto(a.uploader),
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validate size + MIME and store the file, returning the saved Attachment DTO. */
  async upload(
    userId: string,
    issueId: string,
    file: Express.Multer.File,
  ): Promise<AttachmentDto> {
    const maxBytes = getMaxBytes();
    if (file.size > maxBytes) {
      // Remove the temp file multer wrote to disk before rejecting
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `File too large: max ${maxBytes} bytes (${Math.round(maxBytes / 1024 / 1024)} MB)`,
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `File type not allowed: ${file.mimetype}`,
      );
    }

    const issue = await this.getIssue(issueId);
    // VIEWER cannot upload — requires at least MEMBER
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    // Move the temp multer file to the configured uploads dir using the
    // storage key (UUID) as the filename. The client-provided originalname
    // is stored in the DB for display but NEVER used as a filesystem path.
    const storageKey = `${crypto.randomUUID()}${this.ext(file.originalname)}`;
    const uploadsDir = getUploadsDir();
    fs.mkdirSync(uploadsDir, { recursive: true });
    const dest = path.join(uploadsDir, storageKey);
    fs.renameSync(file.path, dest);

    const attachment = await this.prisma.attachment.create({
      data: {
        issueId,
        uploaderId: userId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
      },
      include: { uploader: true },
    });

    return toDto(attachment);
  }

  /** List all attachments on an issue (metadata only). */
  async list(userId: string, issueId: string): Promise<AttachmentDto[]> {
    const issue = await this.getIssue(issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const attachments = await this.prisma.attachment.findMany({
      where: { issueId },
      include: { uploader: true },
      orderBy: { createdAt: 'asc' },
    });
    return attachments.map(toDto);
  }

  /**
   * Resolve the absolute file path for download. Membership-checked.
   * Returns `{ filePath, attachment }` — the caller streams the file.
   */
  async resolveForDownload(
    userId: string,
    attachmentId: string,
  ): Promise<{ filePath: string; attachment: AttachmentDto }> {
    const attachment = await this.findAttachment(attachmentId);
    const issue = await this.getIssue(attachment.issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const filePath = path.join(getUploadsDir(), attachment.storageKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found on disk');
    }
    return { filePath, attachment: toDto(attachment) };
  }

  /**
   * Delete an attachment. Uploader OR project ADMIN may delete.
   * Removes the DB row and the file on disk.
   */
  async remove(userId: string, attachmentId: string): Promise<{ id: string }> {
    const attachment = await this.findAttachment(attachmentId);
    const issue = await this.getIssue(attachment.issueId);

    if (attachment.uploaderId === userId) {
      // Uploader may always delete their own file — just need membership
      await assertProjectMember(this.prisma, userId, issue.projectId);
    } else {
      // Non-uploader must be a project ADMIN
      await assertProjectRole(
        this.prisma,
        userId,
        issue.projectId,
        Role.ADMIN,
      );
    }

    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    this.safeUnlink(path.join(getUploadsDir(), attachment.storageKey));
    return { id: attachmentId };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async getIssue(issueId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  private async findAttachment(id: string) {
    const a = await this.prisma.attachment.findUnique({
      where: { id },
      include: { uploader: true },
    });
    if (!a) throw new NotFoundException('Attachment not found');
    return a;
  }

  private ext(filename: string): string {
    const e = path.extname(filename);
    // Only allow safe, simple extensions (letters + digits, max 10 chars)
    return /^\.[a-zA-Z0-9]{1,10}$/.test(e) ? e : '';
  }

  private safeUnlink(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup; log nothing — the main error path takes precedence
    }
  }
}
