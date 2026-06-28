import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role, VersionState } from '@next-lane/shared';
import type { VersionDto } from '@next-lane/shared';
import { CreateVersionDto, UpdateVersionDto } from './dto/version.dto';

type VersionRow = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  state: string;
  releaseDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { issues: number };
};

function toVersionDto(v: VersionRow): VersionDto {
  const dto: VersionDto = {
    id: v.id,
    projectId: v.projectId,
    name: v.name,
    description: v.description,
    state: v.state as VersionState,
    releaseDate: v.releaseDate ? v.releaseDate.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
  if (v._count !== undefined) {
    dto.issueCount = v._count.issues;
  }
  return dto;
}

const versionInclude = {
  _count: { select: { issues: true } },
} as const;

@Injectable()
export class VersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, projectId: string): Promise<VersionDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const versions = await this.prisma.version.findMany({
      where: { projectId },
      include: versionInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
    return versions.map(toVersionDto);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateVersionDto,
  ): Promise<VersionDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);

    try {
      const version = await this.prisma.version.create({
        data: {
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
        },
        include: versionInclude,
      });
      return toVersionDto(version);
    } catch (err: unknown) {
      // P2002 = unique constraint violation (projectId, name)
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `A version named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateVersionDto,
  ): Promise<VersionDto> {
    const existing = await this.prisma.version.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Version not found');

    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);

    // Auto-set releaseDate to now when transitioning to RELEASED and no date given.
    let effectiveReleaseDate: Date | null | undefined = undefined;
    if (dto.releaseDate !== undefined) {
      effectiveReleaseDate =
        dto.releaseDate === null ? null : new Date(dto.releaseDate);
    } else if (
      dto.state === VersionState.RELEASED &&
      existing.state !== VersionState.RELEASED &&
      existing.releaseDate === null
    ) {
      effectiveReleaseDate = new Date();
    }

    try {
      const version = await this.prisma.version.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.state !== undefined ? { state: dto.state } : {}),
          ...(effectiveReleaseDate !== undefined
            ? { releaseDate: effectiveReleaseDate }
            : {}),
        },
        include: versionInclude,
      });
      return toVersionDto(version);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          `A version named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.version.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Version not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );
    await this.prisma.version.delete({ where: { id } });
  }

  /**
   * Set the complete list of versions for an issue, replacing any existing
   * assignment. All provided version IDs must belong to the issue's project.
   *
   * Design choice: `PUT /issues/:issueId/versions` with `{ versionIds: [] }`
   * replaces the set atomically. This is consistent with the issue's other
   * many-to-many relations and matches the bulk-replace semantics expected by
   * the frontend (one call to replace the selected releases, no need to diff
   * and issue individual add/remove calls). Labels use per-item add/remove
   * because they were added first with that shape; versions use the bulk-replace
   * approach for cleaner UX on a multi-version picker.
   */
  async setIssueVersions(
    userId: string,
    issueId: string,
    versionIds: string[],
  ): Promise<{ id: string; name: string; state: VersionState }[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    // Validate every versionId belongs to the issue's project.
    if (versionIds.length > 0) {
      const versions = await this.prisma.version.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, projectId: true },
      });
      const wrongProject = versions.filter(
        (v) => v.projectId !== issue.projectId,
      );
      if (wrongProject.length > 0) {
        throw new BadRequestException(
          'All version IDs must belong to the issue\'s project',
        );
      }
      // Also catch IDs that don't exist at all.
      if (versions.length !== versionIds.length) {
        const foundIds = new Set(versions.map((v) => v.id));
        const missing = versionIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(
          `Version not found: ${missing.join(', ')}`,
        );
      }
    }

    // Atomically replace the set: delete all existing, create new ones.
    await this.prisma.$transaction([
      this.prisma.issueVersion.deleteMany({ where: { issueId } }),
      ...(versionIds.length > 0
        ? [
            this.prisma.issueVersion.createMany({
              data: versionIds.map((versionId) => ({ issueId, versionId })),
            }),
          ]
        : []),
    ]);

    return this.issueVersionSummaries(issueId);
  }

  private async issueVersionSummaries(
    issueId: string,
  ): Promise<{ id: string; name: string; state: VersionState }[]> {
    const rows = await this.prisma.issueVersion.findMany({
      where: { issueId },
      include: { version: { select: { id: true, name: true, state: true } } },
    });
    return rows.map((r) => ({
      id: r.version.id,
      name: r.version.name,
      state: r.version.state as VersionState,
    }));
  }
}
