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
  getReferencedFieldKinds,
  resolveQueryNames,
  queryReferencesMe,
  type DashboardDataDto,
  type DashboardDto,
  type DashboardGadgetResult,
  type DashboardSummaryDto,
  type IssueDto,
  type NlqlSprint,
  type NlqlUser,
  type ValidateCustomFieldDef,
} from '@next-lane/shared';
import { VELOCITY_TREND_DEFAULT_SPRINTS } from '../reports/reports.service';
import { loadNlqlEvalContext } from '../common/nlql-eval-context.util';
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

/**
 * Hard cap on dashboards per project / gadgets per dashboard. Both surfaces
 * are MEMBER-writable and MCP-writable with no prior upper bound — one bad
 * agent loop could otherwise create hundreds of dashboards or gadgets, and
 * `getDashboardData` fans out one NLQL evaluation per gadget on every read
 * (engineering-auditor Pass 12, P2-2). Enforced with a `BadRequestException`
 * before insert, mirroring `DASHBOARD_ISSUES_CAP`.
 */
export const MAX_DASHBOARDS_PER_PROJECT = 20;
export const MAX_GADGETS_PER_DASHBOARD = 30;

/**
 * A brand-new project's very first dashboard is pre-populated with a small,
 * generically-useful set of gadgets instead of starting empty — closes the
 * Phase-1 "empty by default" scope delta now that the framework is proven.
 * Every subsequent dashboard (including a second dashboard on the same
 * project) still starts empty; this only fires once, on dashboard #1.
 */
const DEFAULT_GADGETS: ReadonlyArray<{
  title: string;
  query: string;
  visualization: DashboardGadgetVisualization;
  config: Record<string, unknown>;
}> = [
  {
    title: 'Open issues',
    query: 'statusCategory != DONE',
    visualization: DashboardGadgetVisualization.STAT,
    config: { position: 0 },
  },
  {
    title: 'Status overview',
    query: '',
    visualization: DashboardGadgetVisualization.BREAKDOWN,
    config: { position: 1, field: 'status' },
  },
  {
    title: 'My open issues',
    query: 'assignee = me() AND statusCategory != DONE',
    visualization: DashboardGadgetVisualization.TABLE,
    config: { position: 2, limit: 10 },
  },
];

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

    const existingCount = await this.prisma.dashboard.count({ where: { projectId } });
    if (existingCount >= MAX_DASHBOARDS_PER_PROJECT) {
      throw new BadRequestException(
        `This project already has the maximum of ${MAX_DASHBOARDS_PER_PROJECT} dashboards. Delete one before creating another.`,
      );
    }

    const last = await this.prisma.dashboard.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;
    const isFirstDashboard = existingCount === 0;

    const dashboard = await this.prisma.dashboard.create({
      data: { projectId, name: dto.name, order },
    });

    let gadgetCount = 0;
    if (isFirstDashboard) {
      await this.prisma.dashboardGadget.createMany({
        data: DEFAULT_GADGETS.map((g) => ({
          dashboardId: dashboard.id,
          title: g.title,
          query: g.query,
          visualization: g.visualization,
          config: g.config as Prisma.InputJsonValue,
        })),
      });
      gadgetCount = DEFAULT_GADGETS.length;
    }

    this.emitDashboardUpdated(projectId, dashboard.id);
    return toDashboardSummaryDto(dashboard, gadgetCount);
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

    const existingGadgetCount = await this.prisma.dashboardGadget.count({
      where: { dashboardId },
    });
    if (existingGadgetCount >= MAX_GADGETS_PER_DASHBOARD) {
      throw new BadRequestException(
        `This dashboard already has the maximum of ${MAX_GADGETS_PER_DASHBOARD} gadgets. Delete one before adding another.`,
      );
    }

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

    const { gadgets, issuesTruncated } = await this.evaluateDashboardGadgets(
      dashboard,
      userId,
    );
    return { dashboardId, gadgets, issuesTruncated };
  }

  /**
   * Evaluate every gadget on a dashboard for a public (unauthenticated)
   * share-token viewer. Callers MUST validate the share token — and that it
   * resolves to `dashboardId` — before calling this; there is no membership
   * check here (a valid, non-revoked share token IS the authorization).
   *
   * `userId` is never available for an anonymous viewer, so every gadget is
   * evaluated with `currentUserId: undefined` — see `evaluateGadget`'s
   * `me()`-degradation contract for what that means for a gadget whose query
   * calls `me()`.
   */
  async getPublicDashboardData(dashboardId: string): Promise<{
    dashboard: DashboardRow;
    project: { id: string; key: string; name: string };
    gadgets: DashboardGadgetResult[];
    issuesTruncated: boolean;
  }> {
    const dashboard = await this.getDashboardOr404(dashboardId);
    const project = await this.prisma.project.findUnique({
      where: { id: dashboard.projectId },
      select: { id: true, key: true, name: true },
    });
    // Should not happen (cascade delete removes the dashboard too), but guard
    // defensively rather than let a null-ref 500 leak internals.
    if (!project) {
      throw new Error('Project not found for dashboard');
    }

    const { gadgets, issuesTruncated } = await this.evaluateDashboardGadgets(
      dashboard,
      undefined,
    );
    return { dashboard, project, gadgets, issuesTruncated };
  }

  /**
   * Shared gadget-evaluation core for both the authenticated
   * (`getDashboardData`) and public (`getPublicDashboardData`) read paths.
   * `userId` is `undefined` for an anonymous public-share-token viewer —
   * every per-gadget check downstream treats that as "no signed-in identity",
   * never as a crash.
   */
  private async evaluateDashboardGadgets(
    dashboard: DashboardRow,
    userId: string | undefined,
  ): Promise<{ gadgets: DashboardGadgetResult[]; issuesTruncated: boolean }> {
    const dashboardId = dashboard.id;
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

    // Batch-load the NLQL side-context (workspace members + project sprints)
    // ONCE for the whole dashboard, not once per gadget and never per issue —
    // union the field kinds referenced across every gadget's stored query so
    // a dashboard with no user/sprint-referencing gadgets skips both queries
    // entirely. See MCP-QA pass 1, finding 1.
    const referencedKinds = new Set<string>();
    for (const row of gadgetRows) {
      for (const kind of getReferencedFieldKinds(row.query)) referencedKinds.add(kind);
    }
    const { users, sprints } = await loadNlqlEvalContext(this.prisma, dashboard.projectId, {
      includeUsers: referencedKinds.has('user'),
      includeSprints: referencedKinds.has('sprint'),
    });

    // Evaluate every gadget in parallel — `evaluateGadget` never throws (it
    // catches internally and returns a per-gadget `error`), so `Promise.all`
    // is safe and preserves `gadgetRows`' order. Bounded by
    // MAX_GADGETS_PER_DASHBOARD, so this can't fan out unboundedly
    // (engineering-auditor Pass 12, P2-2 — was a sequential loop, up to ~200
    // serial NLQL evaluations per read before the cap existed).
    const gadgets: DashboardGadgetResult[] = await Promise.all(
      gadgetRows.map((row) =>
        this.evaluateGadget(
          row,
          dashboard.projectId,
          userId,
          issues,
          customFieldDefs,
          users,
          sprints,
        ),
      ),
    );

    return { gadgets, issuesTruncated };
  }

  /**
   * Evaluate a single gadget's stored NLQL against the pre-loaded issue set
   * and shape the result per visualization. `userId` is `undefined` only for
   * an anonymous public-dashboard-share-token viewer (see
   * `getPublicDashboardData`) — in that case a query that calls `me()`
   * degrades to an explicit per-gadget `error` rather than silently
   * evaluating `me()` as `null` (which would render as "unassigned", a
   * confusing, silently-wrong result, not a crash but not correct either) or
   * throwing and taking the rest of the dashboard down with it.
   */
  private async evaluateGadget(
    row: DashboardGadgetRow,
    projectId: string,
    userId: string | undefined,
    issues: IssueDto[],
    customFieldDefs: ValidateCustomFieldDef[],
    users: NlqlUser[],
    sprints: NlqlSprint[],
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

    // Fail loud on an unresolved assignee/reporter/sprint NAME (MCP-QA pass
    // 1, finding 1 residual) — but only THIS gadget's result becomes an
    // error state; one bad gadget query must never fail the whole dashboard
    // read (same per-gadget-error contract as every other check below).
    const nameCheck = resolveQueryNames(row.query, { users, sprints });
    if (!nameCheck.ok) {
      return {
        ...base,
        error: nameCheck.error?.message ?? 'Unknown user or sprint reference',
      };
    }

    // Anonymous public-dashboard-share-token viewer: a query that calls
    // me() has no identity to resolve against. Fail loud with a per-gadget
    // error rather than let the evaluator's documented library-consumer
    // fallback (`ctx.currentUserId ?? null` — see `resolveFunction` in
    // `@next-lane/shared`) silently turn `assignee = me()` into "unassigned".
    if (userId === undefined && queryReferencesMe(row.query)) {
      return {
        ...base,
        error:
          'This gadget uses me() and needs a signed-in user — not available on a public dashboard link.',
      };
    }

    let filtered: IssueDto[];
    try {
      filtered = filterIssues(issues, row.query, {
        currentUserId: userId,
        customFieldDefs,
        users,
        sprints,
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
            userId ?? '',
            projectId,
            resolved.sprintId,
            { skipMembershipCheck: userId === undefined },
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
      case DashboardGadgetVisualization.VELOCITY_TREND: {
        // Project-wide by design — `filtered` isn't used (there's no single
        // issue set to filter; the trend spans every sprint's own issues).
        // The query is still validated above for pipeline consistency with
        // every other visualization, just not applied here.
        const sprintsCount =
          typeof base.config.sprints === 'number' && base.config.sprints > 0
            ? base.config.sprints
            : VELOCITY_TREND_DEFAULT_SPRINTS;
        try {
          const trend = await this.reports.velocityTrend(
            userId ?? '',
            projectId,
            sprintsCount,
            { skipMembershipCheck: userId === undefined },
          );
          return {
            ...base,
            data: { kind: 'VELOCITY_TREND', sprints: trend.sprints, points: trend.points },
          };
        } catch (err) {
          return {
            ...base,
            error: err instanceof Error ? err.message : 'Failed to compute velocity trend',
          };
        }
      }
      default:
        return { ...base, error: `Unknown visualization '${String(base.visualization)}'` };
    }
  }
}
