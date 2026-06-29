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
import { Role, IssueType } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import {
  CreateIssueTemplateDto,
  UpdateIssueTemplateDto,
  CreateIssueFromTemplateDto,
} from './dto/issue-template.dto';
import { IssuesService } from '../issues/issues.service';
import type { IssueTemplateDto, IssueDto } from '@next-lane/shared';
import { CreateIssueDto } from '../issues/dto/create-issue.dto';

/**
 * Minimal shape of a User row returned by Prisma when included with a template.
 */
type UserRow = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
};

type IssueTemplateRow = {
  id: string;
  projectId: string;
  name: string;
  issueType: string;
  titleTemplate: string | null;
  descriptionTemplate: string | null;
  priority: string | null;
  defaultAssigneeId: string | null;
  defaultAssignee: UserRow | null;
  componentId: string | null;
  labelIds: unknown; // Prisma Json — stored as array
  createdAt: Date;
  updatedAt: Date;
};

function parseLabelIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string');
  }
  return [];
}

function toIssueTemplateDto(t: IssueTemplateRow): IssueTemplateDto {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    issueType: t.issueType as IssueTemplateDto['issueType'],
    titleTemplate: t.titleTemplate,
    descriptionTemplate: t.descriptionTemplate,
    priority: t.priority as IssueTemplateDto['priority'],
    defaultAssignee: t.defaultAssignee ? toUserDto(t.defaultAssignee) : null,
    componentId: t.componentId,
    labelIds: parseLabelIds(t.labelIds),
    createdAt: t.createdAt.toISOString(),
  };
}

const templateInclude = {
  defaultAssignee: true,
} as const;

@Injectable()
export class IssueTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuesSvc: IssuesService,
  ) {}

  /**
   * Validate that a defaultAssigneeId (when provided and non-null) is a
   * workspace member. Mirrors the same check in ComponentsService.
   */
  private async assertDefaultAssigneeInWorkspace(
    workspaceId: string,
    defaultAssigneeId: string | null | undefined,
  ): Promise<void> {
    if (defaultAssigneeId == null) return;
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: defaultAssigneeId, workspaceId } },
    });
    if (!membership) {
      throw new BadRequestException(
        'defaultAssigneeId is not a member of this workspace',
      );
    }
  }

  /**
   * Validate that a componentId (when provided and non-null) belongs to
   * the given project.
   */
  private async assertComponentBelongsToProject(
    projectId: string,
    componentId: string | null | undefined,
  ): Promise<void> {
    if (componentId == null) return;
    const component = await this.prisma.component.findUnique({
      where: { id: componentId },
      select: { projectId: true },
    });
    if (!component || component.projectId !== projectId) {
      throw new BadRequestException(
        'componentId does not belong to this project',
      );
    }
  }

  /**
   * Validate that all labelIds (when provided) belong to the given project.
   * Unknown label IDs are rejected to avoid silently ignoring bad input.
   */
  private async assertLabelsBelongToProject(
    projectId: string,
    labelIds: string[] | undefined,
  ): Promise<void> {
    if (!labelIds || labelIds.length === 0) return;
    const labels = await this.prisma.label.findMany({
      where: { id: { in: labelIds }, projectId },
      select: { id: true },
    });
    if (labels.length !== labelIds.length) {
      throw new BadRequestException(
        'One or more labelIds do not belong to this project',
      );
    }
  }

  async findAll(userId: string, projectId: string): Promise<IssueTemplateDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const templates = await this.prisma.issueTemplate.findMany({
      where: { projectId },
      include: templateInclude,
      orderBy: { name: 'asc' },
    });
    return templates.map((t) => toIssueTemplateDto(t as IssueTemplateRow));
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateIssueTemplateDto,
  ): Promise<IssueTemplateDto> {
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.ADMIN,
    );
    await this.assertDefaultAssigneeInWorkspace(
      project.workspaceId,
      dto.defaultAssigneeId,
    );
    await this.assertComponentBelongsToProject(projectId, dto.componentId);
    await this.assertLabelsBelongToProject(projectId, dto.labelIds);

    try {
      const template = await this.prisma.issueTemplate.create({
        data: {
          projectId,
          name: dto.name,
          issueType: dto.issueType ?? IssueType.TASK,
          titleTemplate: dto.titleTemplate ?? null,
          descriptionTemplate: dto.descriptionTemplate ?? null,
          priority: dto.priority ?? null,
          defaultAssigneeId: dto.defaultAssigneeId ?? null,
          componentId: dto.componentId ?? null,
          labelIds: dto.labelIds ?? [],
        },
        include: templateInclude,
      });
      return toIssueTemplateDto(template as IssueTemplateRow);
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException(
          `A template named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateIssueTemplateDto,
  ): Promise<IssueTemplateDto> {
    const existing = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue template not found');

    const project = await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );

    await this.assertDefaultAssigneeInWorkspace(
      project.workspaceId,
      dto.defaultAssigneeId,
    );

    const targetComponentId =
      dto.componentId !== undefined ? dto.componentId : existing.componentId;
    await this.assertComponentBelongsToProject(existing.projectId, targetComponentId);

    await this.assertLabelsBelongToProject(existing.projectId, dto.labelIds);

    try {
      const template = await this.prisma.issueTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.issueType !== undefined ? { issueType: dto.issueType } : {}),
          ...(dto.titleTemplate !== undefined
            ? { titleTemplate: dto.titleTemplate }
            : {}),
          ...(dto.descriptionTemplate !== undefined
            ? { descriptionTemplate: dto.descriptionTemplate }
            : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.defaultAssigneeId !== undefined
            ? { defaultAssigneeId: dto.defaultAssigneeId }
            : {}),
          ...(dto.componentId !== undefined
            ? { componentId: dto.componentId }
            : {}),
          ...(dto.labelIds !== undefined ? { labelIds: dto.labelIds } : {}),
        },
        include: templateInclude,
      });
      return toIssueTemplateDto(template as IssueTemplateRow);
    } catch (err: unknown) {
      if (isPrismaUniqueViolation(err)) {
        throw new ConflictException(
          `A template named "${dto.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Issue template not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.ADMIN,
    );
    await this.prisma.issueTemplate.delete({ where: { id } });
  }

  /**
   * Create a real issue from a template. The template supplies default field
   * values; any field supplied in `dto` overrides the template's default.
   *
   * Title resolution:
   *  1. Use `dto.title` if provided.
   *  2. Else use `titleTemplate` from the template.
   *  3. If both are absent → 400 (an issue requires a title).
   *
   * After the issue is created, the merged labelIds list is attached via
   * direct IssueLabel upserts so the returned IssueDto includes them.
   */
  async createFromTemplate(
    userId: string,
    id: string,
    dto: CreateIssueFromTemplateDto,
  ): Promise<IssueDto> {
    const template = await this.prisma.issueTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('Issue template not found');

    // Caller must be a project member (MEMBER+ required to create issues).
    await assertProjectMember(this.prisma, userId, template.projectId);

    // Resolve title: dto.title overrides titleTemplate; both absent (or blank) → 400.
    // Use the raw value as the title but trim to check non-emptiness.
    const rawTitle = dto.title ?? template.titleTemplate ?? null;
    const resolvedTitle = rawTitle?.trim() ? rawTitle : null;
    if (!resolvedTitle) {
      throw new BadRequestException(
        'title is required (template has no titleTemplate and no title override was provided)',
      );
    }

    // Resolve per-field: dto override beats template.
    const resolvedAssigneeId =
      dto.assigneeId !== undefined
        ? dto.assigneeId
        : (template.defaultAssigneeId ?? undefined);

    const resolvedComponentId =
      dto.componentId !== undefined
        ? dto.componentId
        : (template.componentId ?? undefined);

    const resolvedDescription =
      dto.description !== undefined
        ? dto.description
        : (template.descriptionTemplate ?? undefined);

    const resolvedPriority =
      dto.priority !== undefined
        ? dto.priority
        : (template.priority as CreateIssueFromTemplateDto['priority'] ?? undefined);

    // Build the CreateIssueDto for IssuesService.create().
    const createDto = new CreateIssueDto();
    createDto.projectId = template.projectId;
    createDto.title = resolvedTitle;
    createDto.type = template.issueType as CreateIssueDto['type'];
    if (resolvedDescription !== undefined) createDto.description = resolvedDescription;
    if (resolvedPriority !== undefined) createDto.priority = resolvedPriority;
    if (resolvedAssigneeId !== undefined) createDto.assigneeId = resolvedAssigneeId as string | undefined;
    if (resolvedComponentId !== undefined) createDto.componentId = resolvedComponentId as string | undefined;
    if (dto.statusId !== undefined) createDto.statusId = dto.statusId;
    if (dto.sprintId !== undefined) createDto.sprintId = dto.sprintId;

    const issue = await this.issuesSvc.create(userId, createDto);

    // Attach labels: merge template labelIds + dto.labelIds override (if provided,
    // dto.labelIds fully replaces; if not provided, template.labelIds are used).
    const templateLabelIds = parseLabelIds(template.labelIds);
    const mergedLabelIds =
      dto.labelIds !== undefined ? dto.labelIds : templateLabelIds;

    if (mergedLabelIds.length > 0) {
      await Promise.all(
        mergedLabelIds.map((labelId) =>
          this.prisma.issueLabel.upsert({
            where: { issueId_labelId: { issueId: issue.id, labelId } },
            update: {},
            create: { issueId: issue.id, labelId },
          }),
        ),
      );
    }

    // Re-fetch the issue to get the full DTO with labels attached.
    // IssuesService.findOne includes labels and all relations.
    return this.issuesSvc.findOne(userId, issue.id);
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}
