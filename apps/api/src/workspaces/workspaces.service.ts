import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertWorkspaceMember,
  assertWorkspaceRole,
} from '../common/membership.util';
import { toUserDto } from '../auth/auth.service';
import { CreateWorkspaceDto, AddMemberDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { Role } from '@next-lane/shared';
import type { WorkspaceDto, MembershipDto } from '@next-lane/shared';
import { AuditService } from '../audit/audit.service';

/** Default upload directory; override with UPLOADS_DIR env var. */
export const DEFAULT_UPLOADS_DIR = './uploads';

function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR;
}

/** Allowed MIME types for workspace logo uploads. SVG is intentionally excluded (XSS risk). */
export const LOGO_ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Max logo size: 2 MB */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  brandColor: string | null;
  logoStorageKey: string | null;
  logoMimeType: string | null;
};

/**
 * Central mapper: converts a Workspace DB row to a WorkspaceDto.
 * All endpoints that return WorkspaceDto must go through this function.
 *
 * - brandColor: passed through as-is (already validated on write).
 * - logoUrl: derived from logoStorageKey; the GET /workspaces/:id/logo endpoint
 *   serves the bytes, so we expose a relative path the client can prefix with
 *   the API base URL.
 */
export function toWorkspaceDto(w: WorkspaceRow): WorkspaceDto {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    createdAt: w.createdAt.toISOString(),
    brandColor: w.brandColor ?? null,
    logoUrl: w.logoStorageKey ? `/workspaces/${w.id}/logo` : null,
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(userId: string): Promise<WorkspaceDto[]> {
    const workspaces = await this.prisma.workspace.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map(toWorkspaceDto);
  }

  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceDto> {
    const slug = await this.uniqueSlug(dto.slug ?? slugify(dto.name));
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug,
        memberships: {
          create: { userId, role: Role.ADMIN },
        },
      },
    });
    return toWorkspaceDto(workspace);
  }

  async findOne(userId: string, id: string): Promise<WorkspaceDto> {
    const workspace = await assertWorkspaceMember(this.prisma, userId, id);
    return toWorkspaceDto(workspace);
  }

  async members(userId: string, id: string): Promise<MembershipDto[]> {
    await assertWorkspaceMember(this.prisma, userId, id);
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.id,
      role: m.role as Role,
      user: toUserDto(m.user),
    }));
  }

  async addMember(
    userId: string,
    id: string,
    dto: AddMemberDto,
    ip?: string | null,
  ): Promise<MembershipDto> {
    await assertWorkspaceRole(this.prisma, userId, id, Role.ADMIN);
    const target = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!target) throw new NotFoundException('User not found');

    // Check if it's a new membership or a role change (for audit action label).
    const existing = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId: id } },
    });
    const action = existing ? 'membership.role_change' : 'membership.add';
    const prevRole = existing?.role ?? null;

    const membership = await this.prisma.membership.upsert({
      where: {
        userId_workspaceId: { userId: target.id, workspaceId: id },
      },
      update: { role: dto.role ?? Role.MEMBER },
      create: {
        userId: target.id,
        workspaceId: id,
        role: dto.role ?? Role.MEMBER,
      },
      include: { user: true },
    });

    this.audit.record({
      workspaceId: id,
      actorId: userId,
      action,
      targetType: 'Membership',
      targetId: membership.id,
      metadata: {
        targetEmail: target.email,
        role: membership.role,
        ...(prevRole ? { previousRole: prevRole } : {}),
      },
      ip,
    });

    return {
      id: membership.id,
      role: membership.role as Role,
      user: toUserDto(membership.user),
    };
  }

  async removeMember(
    userId: string,
    workspaceId: string,
    membershipId: string,
    ip?: string | null,
  ): Promise<{ id: string }> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: true },
    });
    if (!membership || membership.workspaceId !== workspaceId) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.membership.delete({ where: { id: membershipId } });

    this.audit.record({
      workspaceId,
      actorId: userId,
      action: 'membership.remove',
      targetType: 'Membership',
      targetId: membershipId,
      metadata: {
        targetEmail: membership.user.email,
        role: membership.role,
      },
      ip,
    });

    return { id: membershipId };
  }

  // ── Branding ────────────────────────────────────────────────────────────────

  /**
   * PATCH /workspaces/:id — update name and/or brandColor. Admin-only.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceDto> {
    await assertWorkspaceRole(this.prisma, userId, id, Role.ADMIN);

    const data: { name?: string; brandColor?: string | null } = {};

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length < 1) {
        throw new BadRequestException('name must not be empty');
      }
      data.name = trimmed;
    }

    if (dto.brandColor !== undefined) {
      // null is valid (clears the color). Non-null values validated by DTO decorator.
      data.brandColor = dto.brandColor ?? null;
    }

    const workspace = await this.prisma.workspace.update({
      where: { id },
      data,
    });

    return toWorkspaceDto(workspace);
  }

  /**
   * POST /workspaces/:id/logo — upload a logo image. Admin-only.
   * Validates MIME type (png/jpeg/webp only) and size (<= 2 MB).
   * Replaces any previously stored logo file.
   */
  async uploadLogo(
    userId: string,
    workspaceId: string,
    file: Express.Multer.File | undefined,
  ): Promise<WorkspaceDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.size > LOGO_MAX_BYTES) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `Logo file too large: maximum is ${LOGO_MAX_BYTES / 1024 / 1024} MB`,
      );
    }

    // SVG is explicitly rejected to prevent stored XSS.
    if (file.mimetype === 'image/svg+xml') {
      this.safeUnlink(file.path);
      throw new BadRequestException('SVG images are not allowed as logos (XSS risk)');
    }

    if (!LOGO_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      this.safeUnlink(file.path);
      throw new BadRequestException(
        `Logo type not allowed: ${file.mimetype}. Accepted: image/png, image/jpeg, image/webp`,
      );
    }

    // Fetch existing logo key before replacing.
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { logoStorageKey: true },
    });
    if (!existing) throw new NotFoundException('Workspace not found');

    const uploadsDir = getUploadsDir();
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Use the multer-assigned temp filename (already a UUID) as the storage key.
    const storageKey = path.basename(file.path);
    const dest = path.join(uploadsDir, storageKey);
    fs.renameSync(file.path, dest);

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        logoStorageKey: storageKey,
        logoMimeType: file.mimetype,
      },
    });

    // Best-effort: remove previous logo from disk after successful DB update.
    if (existing.logoStorageKey && existing.logoStorageKey !== storageKey) {
      this.safeUnlink(path.join(uploadsDir, existing.logoStorageKey));
    }

    return toWorkspaceDto(workspace);
  }

  /**
   * DELETE /workspaces/:id/logo — remove the logo. Admin-only.
   * Nulls out logoStorageKey + logoMimeType and best-effort deletes the file.
   */
  async deleteLogo(userId: string, workspaceId: string): Promise<WorkspaceDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);

    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { logoStorageKey: true },
    });
    if (!existing) throw new NotFoundException('Workspace not found');

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { logoStorageKey: null, logoMimeType: null },
    });

    if (existing.logoStorageKey) {
      this.safeUnlink(path.join(getUploadsDir(), existing.logoStorageKey));
    }

    return toWorkspaceDto(workspace);
  }

  /**
   * GET /workspaces/:id/logo — resolve the logo file for streaming. PUBLIC.
   * Returns the absolute file path and MIME type. The controller streams the file.
   * Throws NotFoundException when no logo has been set or the file is missing.
   */
  async resolveLogo(
    workspaceId: string,
  ): Promise<{ filePath: string; mimeType: string }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { logoStorageKey: true, logoMimeType: true },
    });

    if (!workspace || !workspace.logoStorageKey || !workspace.logoMimeType) {
      throw new NotFoundException('This workspace has no logo');
    }

    const filePath = path.join(getUploadsDir(), workspace.logoStorageKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Logo file not found on disk');
    }

    return { filePath, mimeType: workspace.logoMimeType };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private safeUnlink(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup; ignore errors.
    }
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = base || 'workspace';
    let candidate = root;
    let n = 1;
    while (
      await this.prisma.workspace.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${root}-${n++}`;
    }
    return candidate;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
