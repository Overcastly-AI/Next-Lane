import { Role } from '@next-lane/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { getEffectiveProjectRole } from './membership.util';

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
 * Every candidate is checked for an effective project role of MEMBER or
 * better (`getEffectiveProjectRole`, which accounts for per-project role
 * overrides) — an ineligible candidate is SKIPPED and the chain continues,
 * so a VIEWER-restricted assignee never silently kills the auto-transition
 * for an issue whose reporter/lead/admin could have carried it (code-review
 * follow-up on 71ae9a0: the original workspace-membership-only check
 * stopped at the first member, and `move()`'s role check then failed the
 * whole issue instead of falling back). The caller (`IssuesService.move`)
 * still runs its own full check as the backstop; callers MUST catch and
 * skip per-issue rather than let one bad actor break a webhook delivery
 * (see `github.service.ts#applyAutoTransition` /
 * `gitlab.service.ts#applyAutoTransition`).
 *
 * Returns `null` when no candidate — including every workspace ADMIN — is
 * eligible (e.g. everyone associated with the issue has left the project).
 */
export async function resolveAutomationActor(
  prisma: PrismaService,
  project: { id: string; workspaceId: string; leadId: string | null },
  issue: { assigneeId: string | null; reporterId: string | null },
): Promise<string | null> {
  const candidates = [issue.assigneeId, issue.reporterId, project.leadId].filter(
    (v): v is string => !!v,
  );

  const isEligible = async (userId: string): Promise<boolean> => {
    const effective = await getEffectiveProjectRole(
      prisma,
      userId,
      project.workspaceId,
      project.id,
    );
    return (
      effective?.role === Role.MEMBER || effective?.role === Role.ADMIN
    );
  };

  for (const userId of candidates) {
    if (await isEligible(userId)) return userId;
  }

  // Fallback: the workspace's longest-tenured eligible ADMIN — normally the
  // workspace creator. Workspace ADMINs are immune to per-project override
  // restrictions, so the eligibility check is a formality that also covers
  // any future change to that rule.
  const admins = await prisma.membership.findMany({
    where: { workspaceId: project.workspaceId, role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  for (const admin of admins) {
    if (await isEligible(admin.userId)) return admin.userId;
  }
  return null;
}
