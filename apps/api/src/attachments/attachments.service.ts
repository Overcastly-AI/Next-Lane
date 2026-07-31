import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Inject } from '@nestjs/common';
import type { Readable } from 'stream';
import {
  STORAGE_DRIVER,
  StorageObjectNotFound,
  type StorageDriver,
} from '../storage/storage.types';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import type { AttachmentDto } from '@next-lane/shared';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fileType = require('file-type') as typeof import('file-type');

/** Default upload directory; override with UPLOADS_DIR env var. */
export const DEFAULT_UPLOADS_DIR = './uploads';

/** Max file size in bytes (default 10 MB). Override with MAX_FILE_BYTES env. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Allowed MIME types for uploaded files.
 * Covers images, PDF, plain text, office docs, archives.
 *
 * NOTE: image/svg+xml is intentionally excluded. SVG files can embed
 * <script> tags that execute in browser context when served with the
 * image/svg+xml Content-Type. Removing SVG from the allowlist eliminates
 * this stored-XSS vector entirely. See security audit Pass 5.
 */
export const ALLOWED_MIME_TYPES = new Set<string>([
  // Raster images (no SVG — see note above)
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
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

/**
 * MIME types whose magic bytes can be detected by the `file-type` package.
 * For these types we validate the actual file content; for the rest (plain
 * text, CSV, markdown — which have no reliable magic-byte signature) we fall
 * back to the declared MIME type + extension check.
 */
const MAGIC_DETECTABLE_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-zip-compressed',
]);

/**
 * For formats where file-type reports a "family" that maps to multiple
 * acceptable MIME types, list the equivalences here.  We accept any type
 * in the same group as long as the declared type is also in that group.
 */
const MIME_EQUIVALENTS: Map<string, Set<string>> = new Map([
  // ZIP-based Office formats share the same zip magic bytes
  [
    'application/zip',
    new Set([
      'application/zip',
      'application/x-zip-compressed',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]),
  ],
  // gzip aliases
  [
    'application/gzip',
    new Set(['application/gzip', 'application/x-gzip']),
  ],
  [
    'application/x-gzip',
    new Set(['application/gzip', 'application/x-gzip']),
  ],
]);

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;
}

function getMaxBytes(): number {
  const v = process.env.MAX_FILE_BYTES;
  return v ? parseInt(v, 10) : DEFAULT_MAX_BYTES;
}

/** Sentinel UserDto used when an attachment uploader has been deleted. */
const DELETED_UPLOADER_DTO = {
  id: '',
  email: '',
  name: 'Deleted User',
  avatarColor: '#94a3b8',
  emailNotifications: false,
  createdAt: new Date(0).toISOString(),
};

function toDto(
  a: {
    id: string;
    issueId: string;
    // uploaderId is nullable: the uploader may have been deleted (onDelete: SetNull).
    uploaderId: string | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    uploader: {
      id: string;
      email: string;
      name: string;
      avatarColor: string;
      emailNotifications: boolean;
      createdAt: Date;
    } | null;
  },
): AttachmentDto {
  return {
    id: a.id,
    issueId: a.issueId,
    uploaderId: a.uploaderId ?? '',
    uploader: a.uploader ? toUserDto(a.uploader) : DELETED_UPLOADER_DTO,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  };
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Validate size + MIME and store the file, returning the saved Attachment DTO. */
  async upload(
    userId: string,
    issueId: string,
    file: Express.Multer.File | undefined,
  ): Promise<AttachmentDto> {
    // Fix #4: Guard against a multipart request with no file field.
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const maxBytes = getMaxBytes();
    if (file.size > maxBytes) {
      // Remove the temp file multer wrote to disk before rejecting
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `File too large: max ${maxBytes} bytes (${Math.round(maxBytes / 1024 / 1024)} MB)`,
      );
    }

    // Fix #2: SVG is no longer in ALLOWED_MIME_TYPES; this check rejects it.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `File type not allowed: ${file.mimetype}`,
      );
    }

    // Fix #3: Magic-byte validation — verify the real file type matches the
    // declared MIME type.  Only performed for types that have a detectable
    // magic-byte signature; plain text / CSV / markdown fall back to the
    // declared type (their content is valid ASCII/UTF-8 without magic bytes).
    if (MAGIC_DETECTABLE_TYPES.has(file.mimetype)) {
      await this.assertMagicBytesMatch(file.path, file.mimetype);
    }

    const issue = await this.getIssue(issueId);
    // VIEWER cannot upload — requires at least MEMBER
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    // Move the temp multer file to the configured uploads dir using the
    // storage key (UUID) as the filename. The client-provided originalname
    // is stored in the DB for display but NEVER used as a filesystem path.
    const storageKey = `${crypto.randomUUID()}${this.ext(file.originalname)}`;
    await this.storage.put(storageKey, file.path, file.mimetype);

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
   *
   * Fix #2 (download side): if a legacy SVG somehow exists in the store,
   * the download Content-Type is overridden to application/octet-stream in
   * the controller so the browser cannot render it inline.
   */
  async resolveForDownload(
    userId: string,
    attachmentId: string,
  ): Promise<{ stream: Readable; attachment: AttachmentDto }> {
    const attachment = await this.findAttachment(attachmentId);
    const issue = await this.getIssue(attachment.issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);

    // A STREAM, not a path: the bytes may live in object storage, where there
    // is no filesystem path to hand to `res.sendFile`. The local driver still
    // opens a plain read stream, so nothing regresses for disk-backed installs.
    try {
      const stream = await this.storage.createReadStream(attachment.storageKey);
      return { stream, attachment: toDto(attachment) };
    } catch (err) {
      // A DB row whose blob is gone is a 404, not a 500 — the same shape the
      // old `fs.existsSync` guard produced.
      if (err instanceof StorageObjectNotFound) {
        throw new NotFoundException('File not found in storage');
      }
      throw err;
    }
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
    // Driver-backed so the blob is removed from wherever it actually lives.
    await this.storage.delete(attachment.storageKey);
    return { id: attachmentId };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Read the first bytes of `filePath` and compare the detected magic-byte
   * MIME type against the declared `declaredMime`.
   *
   * Throws BadRequestException (400) if:
   *   - file-type detects a type that is NOT in the allowlist, OR
   *   - file-type detects a type that doesn't match the declared type
   *     (considering known ZIP-family equivalents).
   *
   * Does NOT throw if file-type returns undefined (unrecognised format) —
   * in that case the declared-type check above already validated the type
   * is on the allowlist, so we accept it.
   */
  private async assertMagicBytesMatch(
    filePath: string,
    declaredMime: string,
  ): Promise<void> {
    let detected: { mime: string } | undefined;
    try {
      detected = await fileType.fromFile(filePath);
    } catch {
      // If file-type itself throws (e.g. permission error) we treat it as
      // undetectable and skip the check — the allowlist check above already
      // ran.  This keeps the upload path robust against library edge cases.
      return;
    }

    if (!detected) {
      // file-type could not detect a type — no magic bytes present (common for
      // plain text / markdown / CSV). Accept the declared type as-is.
      return;
    }

    const detectedMime = detected.mime;

    // Check 1: detected type must itself be on the allowlist.
    if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
      this.safeUnlink(filePath);
      throw new BadRequestException(
        `File content type (${detectedMime}) is not allowed`,
      );
    }

    // Check 2: detected type must match the declared type (modulo known
    // equivalences, e.g. a .docx is a ZIP at the magic-byte level).
    const equivalents =
      MIME_EQUIVALENTS.get(detectedMime) ?? new Set([detectedMime]);
    if (!equivalents.has(declaredMime) && detectedMime !== declaredMime) {
      this.safeUnlink(filePath);
      throw new BadRequestException(
        `File content (${detectedMime}) does not match declared type (${declaredMime})`,
      );
    }
  }

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
