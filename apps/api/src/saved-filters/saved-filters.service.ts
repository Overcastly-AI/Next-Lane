import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateSavedFilterDto, UpdateSavedFilterDto } from './dto/saved-filter.dto';
import { Role, validateQuery } from '@next-lane/shared';
import type { SavedFilterDto, ValidateCustomFieldDef } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Internal row type
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

// ---------------------------------------------------------------------------
// Mapper (isShared → shared, dates → ISO)
// ---------------------------------------------------------------------------

export function toSavedFilterDto(row: SavedFilterRow): SavedFilterDto {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    ownerId: row.ownerId,
    projectId: row.projectId,
    shared: row.isShared,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SavedFiltersService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Shared helper: load custom field defs for NLQL validation ─────────────

  private async loadCustomFieldDefs(
    projectId: string,
  ): Promise<ValidateCustomFieldDef[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
      select: { id: true, key: true, name: true, type: true },
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      type: r.type as ValidateCustomFieldDef['type'],
    }));
  }

  // ── Shared helper: run validateQuery and reject with 400 on failure ────────

  private assertValidQuery(query: string, customFieldDefs: ValidateCustomFieldDef[]): void {
    const result = validateQuery(query, { customFieldDefs });
    if (!result.ok) {
      throw new BadRequestException(
        `Invalid NLQL query: ${result.error?.message ?? 'parse error'}`,
      );
    }
  }

  // ── List ──────────────────────────────────────────────────────────────────

  /**
   * Returns the caller's own filters for `projectId` plus any shared filters
   * for that project (from any owner), ordered by name asc.
   *
   * Authorization: VIEWER+ (any project member).
   */
  async findAll(userId: string, projectId: string): Promise<SavedFilterDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);

    const rows = await this.prisma.savedFilter.findMany({
      where: {
        projectId,
        OR: [
          { ownerId: userId },
          { isShared: true },
        ],
      },
      orderBy: { name: 'asc' },
    });

    return rows.map(toSavedFilterDto);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Creates a saved filter scoped to `projectId`. The query is validated via
   * `validateQuery` using the project's custom field definitions.
   *
   * Authorization: MEMBER+.
   */
  async create(
    userId: string,
    projectId: string,
    dto: CreateSavedFilterDto,
  ): Promise<SavedFilterDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const customFieldDefs = await this.loadCustomFieldDefs(projectId);
    this.assertValidQuery(dto.query, customFieldDefs);

    const row = await this.prisma.savedFilter.create({
      data: {
        ownerId: userId,
        projectId,
        name: dto.name,
        query: dto.query,
        isShared: dto.shared ?? false,
      },
    });

    return toSavedFilterDto(row);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Updates name, query, and/or shared flag. Only the owner may update.
   * Re-validates the query if it is being changed.
   *
   * Authorization: filter owner only (403 for anyone else).
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateSavedFilterDto,
  ): Promise<SavedFilterDto> {
    const existing = await this.prisma.savedFilter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Saved filter not found');
    if (existing.ownerId !== userId) {
      throw new ForbiddenException('Only the owner may modify this saved filter');
    }

    if (dto.query !== undefined && existing.projectId !== null) {
      const customFieldDefs = await this.loadCustomFieldDefs(existing.projectId);
      this.assertValidQuery(dto.query, customFieldDefs);
    } else if (dto.query !== undefined) {
      // No project context — validate without custom field defs
      this.assertValidQuery(dto.query, []);
    }

    const row = await this.prisma.savedFilter.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.query !== undefined ? { query: dto.query } : {}),
        ...(dto.shared !== undefined ? { isShared: dto.shared } : {}),
      },
    });

    return toSavedFilterDto(row);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Deletes a saved filter. Only the owner may delete.
   *
   * Authorization: filter owner only (403 for anyone else).
   */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.savedFilter.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Saved filter not found');
    if (existing.ownerId !== userId) {
      throw new ForbiddenException('Only the owner may delete this saved filter');
    }

    await this.prisma.savedFilter.delete({ where: { id } });
    return { id };
  }
}
