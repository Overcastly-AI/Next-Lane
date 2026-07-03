import { Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Resolve a "who did this" actor for a mutation triggered by an external
 * system event (a GitHub/GitLab `merged` webhook) rather than a live human
 * request. Every other automated mutation in the codebase (the automation
 * engine's rule actions) has a natural actor — the rule creator, or the user
 * whose action triggered the rule; a merge webhook has neither, so we fall
 * back through a small, deliberately-ordered chain of real project people:
 *
 *   1. the issue's assignee (most likely to be "the person who did the work")
 *   2. the issue's reporter
 *   3. the project's lead
 *   4. the workspace's longest-tenured ADMIN
 *
 * Every candidate is checked against actual WORKSPACE membership before
 * being returned — a stale `assigneeId`/`reporterId` pointing at a removed
 * user is skipped, not returned. This is intentionally a coarser check than
 * `assertProjectRole`'s full effective-role resolution (which also accounts
 * for per-project role overrides) — the caller (`IssuesService.move`, via
 * the automated-mutation path) still runs that full check and throws if the
 * chosen actor is genuinely ineligible; callers here MUST catch that and
 * skip the issue rather than let one bad candidate break a whole webhook
 * delivery (see `github.service.ts#applyAutoTransition` /
 * `gitlab.service.ts#applyAutoTransition`).
 *
 * Returns `null` when no candidate is an active workspace member at all
 * (e.g. every person ever associated with the issue has since left).
 */
export async function resolveAutomationActor(
  prisma: PrismaService,
  project: { id: string; workspaceId: string; leadId: string | null },
  issue: { assigneeId: string | null; reporterId: string | null },
): Promise<string | null> {
  const candidates = [issue.assigneeId, issue.reporterId, project.leadId].filter(
    (v): v is string => !!v,
  );

  for (const userId of candidates) {
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
      select: { userId: true },
    });
    if (membership) return membership.userId;
  }

  // Fallback: the workspace's longest-tenured ADMIN — always exists for any
  // workspace with at least one project (the workspace creator).
  const admin = await prisma.membership.findFirst({
    where: { workspaceId: project.workspaceId, role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}
