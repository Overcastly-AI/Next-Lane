import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fileType = require('file-type') as typeof import('file-type');
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectRole,
  assertWorkspaceRole,
} from '../common/membership.util';
import {
  PAGE_IMAGE_MAX_BYTES,
  PAGE_IMAGE_MIME_TYPES,
  Role,
} from '@next-lane/shared';
import type { PageImageDto } from '@next-lane/shared';
import {
  STORAGE_DRIVER,
  StorageObjectNotFound,
  type StorageDriver,
} from '../storage/storage.types';

/**
 * Image types accepted in a page body.
 *
 * SVG is excluded, exactly as it is for workspace logos and attachments: an SVG
 * is an active document that can carry script, and these are rendered inline in
 * the app rather than downloaded.
 *
 * The list itself lives in `@next-lane/shared` so the editor rejects the same
 * set client-side before spending an upload — one source of truth, per the
 * repo's "shared domain types live in packages/shared" convention.
 */
export const PAGE_IMAGE_ALLOWED_MIME_TYPES = new Set<string>(
  PAGE_IMAGE_MIME_TYPES,
);

export { PAGE_IMAGE_MAX_BYTES };

type PageImageRow = {
  id: string;
  pageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
};

function toDto(r: PageImageRow): PageImageDto {
  return {
    id: r.id,
    pageId: r.pageId,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class PageImagesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /**
   * Authorize `userId` for `minRole` on the page's scope and return the page.
   *
   * Mirrors `PagesService.assertPageRole`: the effective PROJECT role for a
   * project page, the WORKSPACE role for a workspace-level one. Images inherit
   * the page's permissions exactly — there is no separate image ACL, which is
   * the property that makes "as private as the page" true rather than aspirational.
   */
  private async loadPageAuthorized(
    userId: string,
    pageId: string,
    minRole: Role,
  ): Promise<{ id: string; workspaceId: string; projectId: string | null }> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true, projectId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    if (page.projectId !== null) {
      await assertProjectRole(this.prisma, userId, page.projectId, minRole);
    } else {
      await assertWorkspaceRole(this.prisma, userId, page.workspaceId, minRole);
    }
    return page;
  }

  async upload(
    userId: string,
    pageId: string,
    file: Express.Multer.File | undefined,
  ): Promise<PageImageDto> {
    if (!file) throw new BadRequestException('No file uploaded');

    // Validate BEFORE the authorization lookup would leave a temp file behind
    // on the error paths below — every throw unlinks first.
    if (file.size > PAGE_IMAGE_MAX_BYTES) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `Image too large: maximum is ${PAGE_IMAGE_MAX_BYTES / 1024 / 1024} MB`,
      );
    }
    if (!PAGE_IMAGE_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `Image type not allowed: ${file.mimetype}. Accepted: PNG, JPEG, GIF, WebP.`,
      );
    }
    // Magic bytes, so a renamed script declared as image/png cannot be stored
    // and later served with an image Content-Type.
    await this.assertMagicBytes(file.path, file.mimetype);

    // MEMBER to write, same as editing the page itself.
    //
    // Wrapped, because every throw from here on leaves multer's temp file on
    // disk. A rejected upload must not cost the host a 10 MB file — and the
    // authorization failure is the one an attacker can trigger on repeat.
    // `put()` consumes the temp file itself on success, so the unlink only
    // ever runs on the failure paths.
    try {
      await this.loadPageAuthorized(userId, pageId, Role.MEMBER);

      const storageKey = `page-image-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
      await this.storage.put(storageKey, file.path, file.mimetype);

      try {
        const created = await this.prisma.pageImage.create({
          data: {
            pageId,
            storageKey,
            filename: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedById: userId,
          },
        });
        return toDto(created as PageImageRow);
      } catch (err) {
        // The object is already in storage and the row that would have named
        // it never existed, so nothing will ever reference — or reclaim — it.
        // `delete` is best-effort by contract and never throws, so this cannot
        // mask the original failure.
        await this.storage.delete(storageKey);
        throw err;
      }
    } catch (err) {
      this.safeUnlink(file.path);
      throw err;
    }
  }

  /** Stream the bytes. VIEWER on the page's scope — no separate image ACL. */
  async resolveForDownload(
    userId: string,
    imageId: string,
  ): Promise<{ stream: Readable; image: PageImageDto }> {
    const row = await this.prisma.pageImage.findUnique({ where: { id: imageId } });
    if (!row) throw new NotFoundException('Image not found');
    await this.loadPageAuthorized(userId, row.pageId, Role.VIEWER);

    try {
      const stream = await this.storage.createReadStream(row.storageKey);
      return { stream, image: toDto(row as PageImageRow) };
    } catch (err) {
      if (err instanceof StorageObjectNotFound) {
        throw new NotFoundException('Image not found in storage');
      }
      throw err;
    }
  }

  async list(userId: string, pageId: string): Promise<PageImageDto[]> {
    await this.loadPageAuthorized(userId, pageId, Role.VIEWER);
    const rows = await this.prisma.pageImage.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toDto(r as PageImageRow));
  }

  async remove(userId: string, imageId: string): Promise<void> {
    const row = await this.prisma.pageImage.findUnique({ where: { id: imageId } });
    if (!row) throw new NotFoundException('Image not found');
    await this.loadPageAuthorized(userId, row.pageId, Role.MEMBER);
    // Blob first: the DB row is the only pointer to it, so dropping the row
    // before the object would orphan bytes nothing can ever reach.
    await this.storage.delete(row.storageKey);
    await this.prisma.pageImage.delete({ where: { id: imageId } });
  }

  private async assertMagicBytes(filePath: string, declared: string): Promise<void> {
    const detected = await fileType.fromFile(filePath);
    if (!detected || detected.mime !== declared) {
      this.safeUnlink(filePath);
      throw new BadRequestException(
        `File content (${detected?.mime ?? 'unknown'}) does not match the declared type (${declared}).`,
      );
    }
  }

  private safeUnlink(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Temp file already gone — nothing to do.
    }
  }
}
