import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectRole,
  assertWorkspaceMember,
  assertWorkspaceRole,
} from '../common/membership.util';
import {
  PAGE_TEMPLATE_STARTERS,
  Role,
  renderPageTemplate,
} from '@next-lane/shared';
import type { PageDto, PageTemplateDto } from '@next-lane/shared';
import {
  CreatePageFromTemplateDto,
  CreatePageTemplateDto,
  UpdatePageTemplateDto,
} from './dto/page-template.dto';
import { PagesService } from '../pages/pages.service';
import {
  CreatePageDto,
  PAGE_CONTENT_MAX_BYTES,
  PAGE_TITLE_FORBIDDEN_RE,
} from '../pages/dto/create-page.dto';

type PageTemplateRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  titleTemplate: string | null;
  content: string;
  builtIn: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toPageTemplateDto(t: PageTemplateRow): PageTemplateDto {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    name: t.name,
    description: t.description,
    titleTemplate: t.titleTemplate,
    content: t.content,
    builtIn: t.builtIn,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

@Injectable()
export class PageTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(PageTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagesSvc: PagesService,
  ) {}

  // ── Starter seeding ───────────────────────────────────────────────────────

  /**
   * Backfill the built-in starters into every workspace that has never been
   * seeded. Runs once at boot so workspaces created before doc templates
   * shipped get the starters without anyone doing anything.
   *
   * Deliberately NOT done lazily inside the list endpoints: a GET that writes
   * is surprising, races with itself under concurrent loads, and breaks on a
   * read-only replica.
   *
   * Failure here must never stop the API from booting — templates are a
   * convenience, and a workspace with none is merely empty, not broken. So the
   * whole pass is wrapped and logged rather than thrown.
   */
  async onModuleInit(): Promise<void> {
    try {
      const pending = await this.prisma.workspace.findMany({
        where: { pageTemplatesSeededAt: null },
        select: { id: true },
      });
      if (pending.length === 0) return;
      let seeded = 0;
      for (const w of pending) {
        if (await this.seedStarters(w.id)) seeded++;
      }
      if (seeded > 0) {
        this.logger.log(
          `Seeded built-in doc templates into ${seeded} workspace(s).`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Doc-template starter backfill skipped: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Idempotently seed `PAGE_TEMPLATE_STARTERS` into one workspace.
   *
   * Concurrency-safe by construction. The marker is claimed with a CONDITIONAL
   * `updateMany({ where: { id, pageTemplatesSeededAt: null } })` — under two
   * API replicas booting together, exactly one gets `count === 1` and does the
   * insert; the other sees 0 and returns. Doing it the obvious way (read the
   * marker, then write) would let both replicas pass the check and double-seed
   * until the unique index rejected the loser mid-way, leaving a partial set.
   *
   * @returns true if THIS call performed the seeding.
   */
  async seedStarters(workspaceId: string): Promise<boolean> {
    const claimed = await this.prisma.workspace.updateMany({
      where: { id: workspaceId, pageTemplatesSeededAt: null },
      data: { pageTemplatesSeededAt: new Date() },
    });
    if (claimed.count === 0) return false;

    await this.prisma.pageTemplate.createMany({
      data: PAGE_TEMPLATE_STARTERS.map((s) => ({
        workspaceId,
        projectId: null,
        name: s.name,
        description: s.description,
        titleTemplate: s.titleTemplate,
        content: s.content,
        builtIn: true,
      })),
      // A name may already be taken by a user-authored template in a workspace
      // that predates seeding. Skip that one rather than aborting the batch —
      // the user's own template wins, which is the right precedence.
      skipDuplicates: true,
    });
    return true;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Workspace-wide templates only (`projectId: null`). */
  async findAllForWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<PageTemplateDto[]> {
    await assertWorkspaceMember(this.prisma, userId, workspaceId);
    const rows = await this.prisma.pageTemplate.findMany({
      where: { workspaceId, projectId: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => toPageTemplateDto(r as PageTemplateRow));
  }

  /**
   * Templates offered when creating a page inside a project: the project's own
   * plus, by default, the workspace-wide ones it inherits.
   *
   * Ordering puts PROJECT templates first, then workspace ones, each
   * alphabetical. A project template exists to override or extend the shared
   * set, so it is the more specific answer and belongs at the top of the
   * picker — and where both scopes define the same name, the project row is
   * the one the user reaches first.
   */
  async findAllForProject(
    userId: string,
    projectId: string,
    includeInherited = true,
  ): Promise<PageTemplateDto[]> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.VIEWER,
    );
    const rows = await this.prisma.pageTemplate.findMany({
      where: includeInherited
        ? {
            workspaceId: project.workspaceId,
            OR: [{ projectId }, { projectId: null }],
          }
        : { projectId },
      orderBy: { name: 'asc' },
    });
    const dtos = rows.map((r) => toPageTemplateDto(r as PageTemplateRow));
    return [
      ...dtos.filter((d) => d.projectId !== null),
      ...dtos.filter((d) => d.projectId === null),
    ];
  }

  async findOne(userId: string, id: string): Promise<PageTemplateDto> {
    const row = await this.loadAuthorized(userId, id, Role.VIEWER);
    return toPageTemplateDto(row);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  async createForWorkspace(
    userId: string,
    workspaceId: string,
    dto: CreatePageTemplateDto,
  ): Promise<PageTemplateDto> {
    await assertWorkspaceRole(this.prisma, userId, workspaceId, Role.ADMIN);
    return this.insert(workspaceId, null, dto);
  }

  async createForProject(
    userId: string,
    projectId: string,
    dto: CreatePageTemplateDto,
  ): Promise<PageTemplateDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.ADMIN,
    );
    return this.insert(project.workspaceId, projectId, dto);
  }

  private async insert(
    workspaceId: string,
    projectId: string | null,
    dto: CreatePageTemplateDto,
  ): Promise<PageTemplateDto> {
    try {
      const created = await this.prisma.pageTemplate.create({
        data: {
          workspaceId,
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          titleTemplate: dto.titleTemplate ?? null,
          content: dto.content ?? '',
          builtIn: false,
        },
      });
      return toPageTemplateDto(created as PageTemplateRow);
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException(
          projectId === null
            ? `A workspace template named "${dto.name}" already exists`
            : `A template named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdatePageTemplateDto,
  ): Promise<PageTemplateDto> {
    await this.loadAuthorized(userId, id, Role.ADMIN);
    try {
      const updated = await this.prisma.pageTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.titleTemplate !== undefined
            ? { titleTemplate: dto.titleTemplate }
            : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
        },
      });
      return toPageTemplateDto(updated as PageTemplateRow);
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException(
          `A template named "${dto.name}" already exists in this scope`,
        );
      }
      throw err;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.loadAuthorized(userId, id, Role.ADMIN);
    await this.prisma.pageTemplate.delete({ where: { id } });
  }

  // ── Use ───────────────────────────────────────────────────────────────────

  /**
   * Create a real page from a template.
   *
   * Destination resolution:
   *  - project-scoped template → always its own project; a conflicting
   *    `dto.projectId` is a 400, never a silent redirect.
   *  - workspace-wide template → `dto.projectId` picks a project, or
   *    omitted/null creates a workspace-level page.
   *
   * Authorization is delegated ENTIRELY to `PagesService.create` /
   * `createWorkspacePage`, which already enforce MEMBER on the destination.
   * Re-deriving it here would be a second, drifting copy of the rule — and the
   * destination, not the template, is what the caller must be allowed to write
   * to. Read access to the template itself is checked first.
   */
  async createPageFromTemplate(
    userId: string,
    id: string,
    dto: CreatePageFromTemplateDto,
  ): Promise<PageDto> {
    const template = await this.loadAuthorized(userId, id, Role.VIEWER);

    const requestedProjectId = dto.projectId ?? null;
    let targetProjectId: string | null;

    if (template.projectId !== null) {
      if (requestedProjectId !== null && requestedProjectId !== template.projectId) {
        throw new BadRequestException(
          'This template belongs to a different project; it can only create pages in its own project',
        );
      }
      targetProjectId = template.projectId;
    } else {
      targetProjectId = requestedProjectId;
    }

    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const title = this.resolveTitle(template, dto, author?.name ?? 'Unknown');
    const content = renderPageTemplate(template.content, {
      title,
      author: author?.name ?? 'Unknown',
      now: new Date(),
    });

    // The template body is capped at PAGE_TEMPLATE_CONTENT_MAX *characters*,
    // but Page.content is capped in UTF-8 BYTES — and token expansion can only
    // grow the string. Check the rendered result against the page's own limit
    // so a template that renders past it fails with an explanation instead of
    // a raw DB/DTO error further down.
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > PAGE_CONTENT_MAX_BYTES) {
      throw new BadRequestException(
        `Rendered template is ${Math.ceil(bytes / 1024)} KB, over the ${Math.floor(
          PAGE_CONTENT_MAX_BYTES / 1024,
        )} KB page limit`,
      );
    }

    const createDto = new CreatePageDto();
    createDto.title = title;
    createDto.content = content;
    if (dto.parentId !== undefined) createDto.parentId = dto.parentId;

    return targetProjectId === null
      ? this.pagesSvc.createWorkspacePage(userId, template.workspaceId, createDto)
      : this.pagesSvc.create(userId, targetProjectId, createDto);
  }

  /**
   * Resolve and validate the new page's title.
   *
   * `dto.title` wins over `titleTemplate`; if neither yields a non-blank
   * string, that's a 400 (a page requires a title).
   *
   * The result is re-checked against `PAGE_TITLE_FORBIDDEN_RE` AFTER token
   * substitution. The DTO already screens the raw template, but `{{author}}`
   * expands to a user-controlled display name that could contain `[`, `]` or
   * `|` — which would produce a page no `[[wiki-link]]` could ever address.
   * Catching it here turns a silently-unlinkable page into a clear rejection.
   */
  private resolveTitle(
    template: PageTemplateRow,
    dto: CreatePageFromTemplateDto,
    authorName: string,
  ): string {
    const raw = dto.title ?? template.titleTemplate ?? '';
    const rendered = renderPageTemplate(raw, {
      // A `{{title}}` token inside titleTemplate itself has nothing to resolve
      // to yet — substituting the half-built title would be circular — so it
      // renders to empty and is trimmed away below.
      title: '',
      author: authorName,
      now: new Date(),
    }).trim();

    if (!rendered) {
      throw new BadRequestException(
        'title is required (this template has no titleTemplate and no title override was provided)',
      );
    }
    if (rendered.length > 300) {
      throw new BadRequestException(
        'Rendered title exceeds 300 characters',
      );
    }
    if (!PAGE_TITLE_FORBIDDEN_RE.test(rendered)) {
      throw new BadRequestException(
        'Rendered title must not contain the characters [ ] | (they are reserved for [[wiki-links]])',
      );
    }
    return rendered;
  }

  // ── Shared authorization ──────────────────────────────────────────────────

  /**
   * Load a template and authorize `userId` for `minRole` on ITS scope —
   * effective project role for a project template, workspace role for a
   * workspace-wide one. Mirrors `PagesService.assertPageRole`.
   */
  private async loadAuthorized(
    userId: string,
    id: string,
    minRole: Role,
  ): Promise<PageTemplateRow> {
    const row = await this.prisma.pageTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Page template not found');
    if (row.projectId !== null) {
      await assertProjectRole(this.prisma, userId, row.projectId, minRole);
    } else {
      await assertWorkspaceRole(this.prisma, userId, row.workspaceId, minRole);
    }
    return row as PageTemplateRow;
  }
}
