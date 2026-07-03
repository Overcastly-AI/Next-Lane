import type { NlqlSprint, NlqlUser } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The side-context an NLQL evaluation needs beyond the issue rows themselves:
 * workspace members (to resolve `assignee`/`reporter` by name or email) and
 * project sprints (to resolve `sprint` by name). See MCP-QA pass 1, finding 1
 * — the evaluator has always supported this resolution
 * (`packages/shared/src/nlql/evaluator.ts`); server call sites just weren't
 * populating it.
 */
export interface NlqlEvalContextData {
  users: NlqlUser[];
  sprints: NlqlSprint[];
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
}

/**
 * Load the workspace members + project sprints needed to resolve
 * name/email-based NLQL fields, in exactly one round trip per side-context
 * (never per issue — callers must batch-load once per evaluation and reuse
 * the result across every issue / every gadget in that evaluation).
 */
export async function loadNlqlEvalContext(
  prisma: PrismaService,
  projectId: string,
  options: LoadNlqlEvalContextOptions = {},
): Promise<NlqlEvalContextData> {
  const { includeUsers = true, includeSprints = true } = options;
  if (!includeUsers && !includeSprints) {
    return { users: [], sprints: [] };
  }

  const project = includeUsers
    ? await prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      })
    : null;

  const [memberships, sprintRows] = await Promise.all([
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
  ]);

  const users: NlqlUser[] = memberships.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
  }));
  const sprints: NlqlSprint[] = sprintRows.map((s) => ({ id: s.id, name: s.name }));

  return { users, sprints };
}
