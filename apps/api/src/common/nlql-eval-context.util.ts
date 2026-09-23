import type {
  NlqlComponent,
  NlqlLabelRef,
  NlqlSprint,
  NlqlStatusRef,
  NlqlUser,
} from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The side-context an NLQL evaluation needs beyond the issue rows themselves:
 * workspace members (to resolve `assignee`/`reporter` by name or email),
 * project sprints (to resolve `sprint` by name), and — MCP-QA pass 4,
 * finding E1 — project statuses/labels/components (to fail loud on a typo'd
 * `status`/`label`/`component` value the same way `assignee`/`sprint`
 * already do). See MCP-QA pass 1, finding 1 — the evaluator has always
 * supported user/sprint resolution (`packages/shared/src/nlql/evaluator.ts`);
 * server call sites just weren't populating it, and later weren't populating
 * the status/label/component equivalents either.
 */
export interface NlqlEvalContextData {
  users: NlqlUser[];
  sprints: NlqlSprint[];
  statuses: NlqlStatusRef[];
  labels: NlqlLabelRef[];
  components: NlqlComponent[];
}

export interface LoadNlqlEvalContextOptions {
  /**
   * Skip the workspace-membership query. Pass `false` when the caller has
   * already determined (e.g. via `getReferencedFieldKinds`) that the query
   * being evaluated does not reference a `user`-kind field.
   * @default true
   */
  includeUsers?: boolean;
  /**
   * Skip the project-sprints query. Pass `false` when the caller has already
   * determined the query does not reference the `sprint` field.
   * @default true
   */
  includeSprints?: boolean;
  /**
   * Skip the project-statuses query. Pass `false` when the caller has
   * already determined (via `getReferencedStandardFields`) that the query
   * does not reference the `status` field specifically — `status` shares
   * the `'enum'` FieldKind with `type`/`priority`/`statusCategory`, which
   * never need this side-context (fixed, global enums).
   * @default true
   */
  includeStatuses?: boolean;
  /**
   * Skip the project-labels query. Pass `false` when the caller has already
   * determined the query does not reference the `label`/`labels` field.
   * @default true
   */
  includeLabels?: boolean;
  /**
   * Skip the project-components query. Pass `false` when the caller has
   * already determined the query does not reference the `component`
   * FieldKind.
   * @default true
   */
  includeComponents?: boolean;
}

/**
 * Load the workspace members + project sprints/statuses/labels/components
 * needed to resolve name/email-based NLQL fields, in exactly one round trip
 * per side-context (never per issue — callers must batch-load once per
 * evaluation and reuse the result across every issue / every gadget in that
 * evaluation).
 */
export async function loadNlqlEvalContext(
  prisma: PrismaService,
  projectId: string,
  options: LoadNlqlEvalContextOptions = {},
): Promise<NlqlEvalContextData> {
  const {
    includeUsers = true,
    includeSprints = true,
    includeStatuses = true,
    includeLabels = true,
    includeComponents = true,
  } = options;
  if (
    !includeUsers &&
    !includeSprints &&
    !includeStatuses &&
    !includeLabels &&
    !includeComponents
  ) {
    return { users: [], sprints: [], statuses: [], labels: [], components: [] };
  }

  const project = includeUsers
    ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      })
    : null;

  const [memberships, sprintRows, statusRows, labelRows, componentRows] = await Promise.all([
    includeUsers && project
      ? prisma.membership.findMany({
          where: { workspaceId: project.workspaceId },
          include: { user: { select: { id: true, email: true, name: true } } },
        })
      : Promise.resolve([]),
    includeSprints
      ? prisma.sprint.findMany({
          where: { projectId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    includeStatuses
      ? prisma.status.findMany({
          where: { projectId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    includeLabels
      ? prisma.label.findMany({
          where: { projectId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    includeComponents
      ? prisma.component.findMany({
          where: { projectId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const users: NlqlUser[] = memberships.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
  }));
  const sprints: NlqlSprint[] = sprintRows.map((s) => ({ id: s.id, name: s.name }));
  const statuses: NlqlStatusRef[] = statusRows.map((s) => ({ id: s.id, name: s.name }));
  const labels: NlqlLabelRef[] = labelRows.map((l) => ({ id: l.id, name: l.name }));
  const components: NlqlComponent[] = componentRows.map((c) => ({ id: c.id, name: c.name }));

  return { users, sprints, statuses, labels, components };
}
