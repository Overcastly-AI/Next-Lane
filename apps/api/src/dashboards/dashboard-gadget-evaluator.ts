/**
 * Pure gadget-shaping helpers: given an already-filtered `IssueDto[]` (the
 * result of `filterIssues(issues, gadget.query, ctx)`), shape it per
 * visualization. Kept framework-free (no Prisma/Nest imports) so it's easily
 * unit-testable; `DashboardsService` wires these to the DB + NLQL evaluator.
 */
import {
  CustomFieldType,
  type DashboardBreakdownGadgetData,
  type DashboardGadgetConfig,
  type DashboardStatGadgetData,
  type DashboardTableGadgetData,
  type DashboardTableRow,
  type IssueDto,
  type ValidateCustomFieldDef,
} from '@next-lane/shared';

/** Hard cap on rows returned by a TABLE gadget, regardless of `config.limit`. */
export const TABLE_GADGET_ROW_CAP = 50;
/** Default row count for a TABLE gadget when `config.limit` is unset. */
export const TABLE_GADGET_DEFAULT_LIMIT = 10;
/** Hard cap on buckets returned by a BREAKDOWN gadget (busiest first). */
export const BREAKDOWN_BUCKET_CAP = 25;

const TABLE_ALL_COLUMNS = ['key', 'title', 'status', 'assignee', 'points'] as const;
type TableColumn = (typeof TABLE_ALL_COLUMNS)[number];

function isTableColumn(v: string): v is TableColumn {
  return (TABLE_ALL_COLUMNS as readonly string[]).includes(v);
}

export function evaluateStat(issues: IssueDto[]): DashboardStatGadgetData {
  return { kind: 'STAT', count: issues.length };
}

export function evaluateTable(
  issues: IssueDto[],
  config: DashboardGadgetConfig,
): DashboardTableGadgetData {
  const columns =
    config.columns && config.columns.length > 0
      ? config.columns.filter(isTableColumn)
      : [...TABLE_ALL_COLUMNS];
  const effectiveColumns = columns.length > 0 ? columns : [...TABLE_ALL_COLUMNS];

  const limit = Math.min(
    config.limit && config.limit > 0 ? config.limit : TABLE_GADGET_DEFAULT_LIMIT,
    TABLE_GADGET_ROW_CAP,
  );

  const rows: DashboardTableRow[] = issues.slice(0, limit).map((issue) => ({
    id: issue.id,
    key: issue.key,
    title: issue.title,
    status: issue.status?.name ?? '',
    assignee: issue.assignee?.name ?? null,
    points: issue.storyPoints,
  }));

  return {
    kind: 'TABLE',
    columns: effectiveColumns,
    rows,
    truncated: issues.length > limit,
  };
}

/** Standard (non-custom) breakdown fields, case-insensitive. */
const STANDARD_BREAKDOWN_FIELDS = [
  'status',
  'assignee',
  'priority',
  'type',
  'label',
  'component',
] as const;

/**
 * Group `issues` into buckets by `config.field`. Returns an error string
 * (never throws) when `field` is missing or doesn't resolve to a known
 * standard field or a SELECT/MULTI_SELECT custom field.
 */
export function evaluateBreakdown(
  issues: IssueDto[],
  config: DashboardGadgetConfig,
  customFieldDefs: ValidateCustomFieldDef[],
): { data?: DashboardBreakdownGadgetData; error?: string } {
  const field = config.field?.trim();
  if (!field) {
    return {
      error:
        'BREAKDOWN gadgets need a field to group by — set config.field to ' +
        'status, assignee, priority, type, label, component, or a custom SELECT field key.',
    };
  }

  const lower = field.toLowerCase();
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  if ((STANDARD_BREAKDOWN_FIELDS as readonly string[]).includes(lower)) {
    for (const issue of issues) {
      switch (lower) {
        case 'status':
          bump(issue.status?.name ?? 'Unknown');
          break;
        case 'assignee':
          bump(issue.assignee?.name ?? 'Unassigned');
          break;
        case 'priority':
          bump(issue.priority);
          break;
        case 'type':
          bump(issue.type);
          break;
        case 'component':
          bump(issue.component?.name ?? 'No component');
          break;
        case 'label':
          if (!issue.labels || issue.labels.length === 0) {
            bump('No label');
          } else {
            for (const l of issue.labels) bump(l.name);
          }
          break;
      }
    }
  } else {
    // Custom SELECT / MULTI_SELECT field, matched by key or display name.
    const def = customFieldDefs.find(
      (d) => d.key.toLowerCase() === lower || d.name.toLowerCase() === lower,
    );
    if (!def || (def.type !== CustomFieldType.SELECT && def.type !== CustomFieldType.MULTI_SELECT)) {
      return {
        error: `Unknown breakdown field '${field}' — expected status, assignee, ` +
          'priority, type, label, component, or a custom SELECT field key.',
      };
    }
    for (const issue of issues) {
      const raw = issue.customFields?.[def.id];
      if (def.type === CustomFieldType.MULTI_SELECT && Array.isArray(raw)) {
        if (raw.length === 0) bump('Unset');
        else for (const v of raw) bump(String(v));
      } else if (raw !== undefined && raw !== null && raw !== '') {
        bump(String(raw));
      } else {
        bump('Unset');
      }
    }
  }

  const buckets = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, BREAKDOWN_BUCKET_CAP);

  return { data: { kind: 'BREAKDOWN', field, buckets } };
}

/**
 * Resolve the single sprint a BURNDOWN gadget's filtered issues belong to.
 * Returns an error string (never throws) when the filtered set spans zero or
 * more than one sprint — the gadget's NLQL query is the only sprint scoping
 * mechanism, so this is a query-authoring hint, not a 500.
 */
export function resolveBurndownSprintId(
  issues: IssueDto[],
): { sprintId?: string; error?: string } {
  const sprintIds = new Set(
    issues.map((i) => i.sprintId).filter((id): id is string => !!id),
  );
  if (sprintIds.size === 0) {
    return {
      error:
        'No issues matched by this query belong to a sprint — add a sprint ' +
        'filter, e.g. sprint = "Sprint 1".',
    };
  }
  if (sprintIds.size > 1) {
    return {
      error:
        'Issues matched by this query span multiple sprints — refine the ' +
        'query to match issues in exactly one sprint.',
    };
  }
  return { sprintId: [...sprintIds][0] };
}
