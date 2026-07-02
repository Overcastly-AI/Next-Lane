import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { RealtimeService } from '../realtime/realtime.service';
import { assertProjectMember, assertProjectRole } from '../common/membership.util';
import { toIssueDto } from '../issues/issue.mapper';
import {
  DashboardGadgetVisualization,
  Role,
  SocketEvents,
  filterIssues,
  validateQuery,
  type DashboardDataDto,
  type DashboardDto,
  type DashboardGadgetResult,
  type DashboardSummaryDto,
  type IssueDto,
  type ValidateCustomFieldDef,
} from '@next-lane/shared';
import {
  evaluateBreakdown,
  evaluateStat,
  evaluateTable,
  resolveBurndownSprintId,
} from './dashboard-gadget-evaluator';
import {
  gadgetPosition,
  parseGadgetConfig,
  sortGadgets,
  toDashboardDto,
  toDashboardGadgetDto,
  toDashboardSummaryDto,
  type DashboardGadgetRow,
  type DashboardRow,
} from './dashboard.mapper';
import type { CreateDashboardDto } from './dto/create-dashboard.dto';
import type { UpdateDashboardDto } from './dto/update-dashboard.dto';
import type { CreateDashboardGadgetDto } from './dto/create-dashboard-gadget.dto';
import type { UpdateDashboardGadgetDto } from './dto/update-dashboard-gadget.dto';

/**
 * Hard cap on the number of project issues loaded to evaluate a dashboard's
 * gadgets. Mirrors BOARD_ISSUES_CAP / CSV_ROW_CAP — prevents an OOM on
 * projects with thousands of issues; `issuesTruncated` tells the UI when the
 * evaluated set was partial.
 */
export const DASHBOARD_ISSUES_CAP = 2000;

const issueInclude = {
  status: true,
  assignee: true,
  labels: { include: { label: true } },
  project: { select: { key: true } },
  component: { select: { id: true, name: true } },
} satisfies Prisma.IssueInclude;

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly realtime: RealtimeService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Notify everyone else viewing this project that a dashboard/gadget
   * changed, so a second open tab refreshes without a manual reload — mirrors
   * the `project.updated` pattern. Payload is intentionally minimal
   * (`{ dashboardId }`); clients refetch rather than trust a pushed DTO,
   * since gadget CRUD affects a nested collection the dashboard DTO doesn't
   * fully carry on every mutation shape.
   */
  private emitDashboardUpdated(projectId: string, dashboardId: string): void {
    this.realtime.emitToProject(projectId, SocketEvents.DashboardUpdated, {
      dashboardId,
    });
  }

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

  private async getDashboardOr404(dashboardId: string): Promise<DashboardRow> {
    const dashboard = await this.prisma.dashboard.findUnique({
      where: { id: dashboardId },
    });
    if (!dashboard) throw new NotFoundException('Dashboard not found');
    return dashboard;
  }

  private async getGadgetOr404(gadgetId: string): Promise<
    DashboardGadgetRow & { dashboard: DashboardRow }
  > {
    const gadget = await this.prisma.dashboardGadget.findUnique({
      where: { id: gadgetId },
      include: { dashboard: true },
    });
    if (!gadget) throw new NotFoundException('Gadget not found');
    return gadget;
  }

  // ── Dashboards ───────────────────────────────────────────────────────────

  async listDashboards(
    userId: string,
    projectId: string,
  ): Promise<DashboardSummaryDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const dashboards = await this.prisma.dashboard.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { gadgets: true } } },
    });
    return dashboards.map((d) => toDashboardSummaryDto(d, d._count.gadgets));
  }

  async createDashboard(
    userId: string,
    projectId: string,
    dto: CreateDashboardDto,
  ): Promise<DashboardSummaryDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const last = await this.prisma.dashboard.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    const dashboard = await this.prisma.dashboard.create({
      data: { projectId, name: dto.name, order },
    });
    this.emitDashboardUpdated(projectId, dashboard.id);
    return toDashboardSummaryDto(dashboard, 0);
  }

  async getDashboard(userId: string, dashboardId: string): Promise<DashboardDto> {
    const dashboard = await this.getDashboardOr404(dashboardId);
    await assertProjectMember(this.prisma, userId, dashboard.projectId);

    const gadgets = await this.prisma.dashboardGadget.findMany({
      where: { dashboardId },
    });
    return toDashboardDto(dashboard, gadgets);
  }

  async updateDashboard(
    userId: string,
    dashboardId: string,
    dto: UpdateDashboardDto,
  ): Promise<DashboardSummaryDto> {
    const dashboard = await this.getDashboardOr404(dashboardId);
    await assertProjectRole(this.prisma, userId, dashboard.projectId, Role.MEMBER);

    const data: Prisma.DashboardUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.order !== undefined) data.order = dto.order;

    const updated = await this.prisma.dashboard.update({
      where: { id: dashboardId },
      data,
    });
    const gadgetCount = await this.prisma.dashboardGadget.count({
      where: { dashboardId },
    });
    this.emitDashboardUpdated(dashboard.projectId, dashboardId);
    return toDashboardSummaryDto(updated, gadgetCount);
  }

  async deleteDashboard(userId: string, dashboardId: string): Promise<void> {
    const dashboard = await this.getDashboardOr404(dashboardId);
    await assertProjectRole(this.prisma, userId, dashboard.projectId, Role.MEMBER);
    await this.prisma.dashboard.delete({ where: { id: dashboardId } });
    this.emitDashboardUpdated(dashboard.projectId, dashboardId);
  }

  // ── Gadgets ──────────────────────────────────────────────────────────────

  private assertValidGadgetQuery(
    query: string,
    customFieldDefs: ValidateCustomFieldDef[],
  ): void {
    const result = validateQuery(query, { customFieldDefs });
    if (!result.ok) {
      throw new BadRequestException(
        `Invalid gadget query: ${result.error?.message ?? 'parse error'}`,
      );
    }
  }

  async createGadget(
    userId: string,
    dashboardId: string,
    dto: CreateDashboardGadgetDto,
  ) {
    const dashboard = await this.getDashboardOr404(dashboardId);
    await assertProjectRole(this.prisma, userId, dashboard.projectId, Role.MEMBER);

    const customFieldDefs = await this.loadCustomFieldDefs(dashboard.projectId);
    this.assertValidGadgetQuery(dto.query, customFieldDefs);

    if (
      dto.visualization === DashboardGadgetVisualization.BREAKDOWN &&
      !dto.config?.field
    ) {
      throw new BadRequestException(
        'BREAKDOWN gadgets require config.field (e.g. "status", "assignee", "priority").',
      );
    }

    const last = await this.prisma.dashboardGadget.findMany({
      where: { dashboardId },
    });
    const nextPosition =
      last.length === 0 ? 0 : Math.max(...last.map(gadgetPosition)) + 1;

    const gadget = await this.prisma.dashboardGadget.create({
      data: {
        dashboardId,
        title: dto.title,
        query: dto.query,
        visualization: dto.visualization,
        config: {
          ...dto.config,
          position: dto.config?.position ?? nextPosition,
        } as Prisma.InputJsonValue,
      },
    });
    this.emitDashboardUpdated(dashboard.projectId, dashboardId);
    return toDashboardGadgetDto(gadget);
  }

  async updateGadget(
    userId: string,
    gadgetId: string,
    dto: UpdateDashboardGadgetDto,
  ) {
    const gadget = await this.getGadgetOr404(gadgetId);
    await assertProjectRole(
      this.prisma,
      userId,
      gadget.dashboard.projectId,
      Role.MEMBER,
    );

    const customFieldDefs = await this.loadCustomFieldDefs(
      gadget.dashboard.projectId,
    );
    if (dto.query !== undefined) {
      this.assertValidGadgetQuery(dto.query, customFieldDefs);
    }

    const visualization = dto.visualization ?? gadget.visualization;
    const existingConfig = parseGadgetConfig(gadget.config);
    const mergedConfig = { ...existingConfig, ...(dto.config ?? {}) };

    if (
      visualization === DashboardGadgetVisualization.BREAKDOWN &&
      !mergedConfig.field
    ) {
      throw new BadRequestException(
        'BREAKDOWN gadgets require config.field (e.g. "status", "assignee", "priority").',
      );
    }

    const data: Prisma.DashboardGadgetUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.query !== undefined) data.query = dto.query;
    if (dto.visualization !== undefined) data.visualization = dto.visualization;
    if (dto.config !== undefined) {
      data.config = mergedConfig as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.dashboardGadget.update({
      where: { id: gadgetId },
      data,
    });
    this.emitDashboardUpdated(gadget.dashboard.projectId, gadget.dashboardId);
    return toDashboardGadgetDto(updated);
  }

  async deleteGadget(userId: string, gadgetId: string): Promise<void> {
    const gadget = await this.getGadgetOr404(gadgetId);
    await assertProjectRole(
      this.prisma,
      userId,
      gadget.dashboard.projectId,
      Role.MEMBER,
    );
    await this.prisma.dashboardGadget.delete({ where: { id: gadgetId } });
    this.emitDashboardUpdated(gadget.dashboard.projectId, gadget.dashboardId);
  }

  // ── Data ─────────────────────────────────────────────────────────────────

  /**
   * Evaluate every gadget on a dashboard server-side: validate each gadget's
   * stored NLQL, filter the project's issues with the shared evaluator, then
   * shape the result per visualization. A gadget whose query or config can't
   * be evaluated gets a per-gadget `error` — never a 500 for the whole
   * dashboard.
   */
  async getDashboardData(
    userId: string,
    dashboardId: string,
  ): Promise<DashboardDataDto> {
    const dashboard = await this.getDashboardOr404(dashboardId);
    await assertProjectMember(this.prisma, userId, dashboard.projectId);

    const gadgetRows = sortGadgets(
      await this.prisma.dashboardGadget.findMany({ where: { dashboardId } }),
    );

    const customFieldDefs = await this.loadCustomFieldDefs(dashboard.projectId);

    const issueRows = await this.prisma.issue.findMany({
      where: { projectId: dashboard.projectId },
      include: issueInclude,
      orderBy: { number: 'asc' },
      take: DASHBOARD_ISSUES_CAP + 1,
    });
    const issuesTruncated = issueRows.length > DASHBOARD_ISSUES_CAP;
    if (issuesTruncated) issueRows.splice(DASHBOARD_ISSUES_CAP);
    const issues: IssueDto[] = issueRows.map(toIssueDto);

    const gadgets: DashboardGadgetResult[] = [];
    for (const row of gadgetRows) {
      gadgets.push(
        await this.evaluateGadget(row, dashboard.projectId, userId, issues, customFieldDefs),
      );
    }

    return { dashboardId, gadgets, issuesTruncated };
  }

  private async evaluateGadget(
    row: DashboardGadgetRow,
    projectId: string,
    userId: string,
    issues: IssueDto[],
    customFieldDefs: ValidateCustomFieldDef[],
  ): Promise<DashboardGadgetResult> {
    const base = {
      gadgetId: row.id,
      title: row.title,
      visualization: row.visualization as DashboardGadgetVisualization,
      config: parseGadgetConfig(row.config),
    };

    const validation = validateQuery(row.query, { customFieldDefs });
    if (!validation.ok) {
      return { ...base, error: validation.error?.message ?? 'Invalid query' };
    }

    let filtered: IssueDto[];
    try {
      filtered = filterIssues(issues, row.query, {
        currentUserId: userId,
        customFieldDefs,
      });
    } catch (err) {
      return {
        ...base,
        error: err instanceof Error ? err.message : 'Failed to evaluate query',
      };
    }

    switch (base.visualization) {
      case DashboardGadgetVisualization.STAT:
        return { ...base, data: evaluateStat(filtered) };
      case DashboardGadgetVisualization.TABLE:
        return { ...base, data: evaluateTable(filtered, base.config) };
      case DashboardGadgetVisualization.BREAKDOWN: {
        const result = evaluateBreakdown(filtered, base.config, customFieldDefs);
        return result.data
          ? { ...base, data: result.data }
          : { ...base, error: result.error ?? 'Unable to compute breakdown' };
      }
      case DashboardGadgetVisualization.BURNDOWN: {
        const resolved = resolveBurndownSprintId(filtered);
        if (!resolved.sprintId) {
          return { ...base, error: resolved.error ?? 'Unable to resolve sprint' };
        }
        try {
          const burndown = await this.reports.burndown(
            userId,
            projectId,
            resolved.sprintId,
          );
          return {
            ...base,
            data: {
              kind: 'BURNDOWN',
              sprintId: burndown.sprintId,
              sprintName: burndown.sprintName,
              totalCommitted: burndown.totalCommitted,
              series: burndown.series,
            },
          };
        } catch (err) {
          return {
            ...base,
            error: err instanceof Error ? err.message : 'Failed to compute burndown',
          };
        }
      }
      default:
        return { ...base, error: `Unknown visualization '${String(base.visualization)}'` };
    }
  }
}
