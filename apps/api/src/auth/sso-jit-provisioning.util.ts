/**
 * SSO/OIDC Phase 2 — shared just-in-time (JIT) workspace/role provisioning,
 * used identically by the legacy single-provider `OidcService` and the new
 * multi-provider `SsoService` (SAML + additional OIDC rows).
 *
 * Rule (conservative by design — see `SsoProvider`'s Prisma doc comment):
 *   - Only ever called for a BRAND NEW user (the very first successful SSO
 *     login that creates their `User` row) — an already-existing user's
 *     memberships are never touched by a later SSO login, no matter what a
 *     provider's JIT config says. Callers enforce the "brand new" condition;
 *     this function itself is a plain (idempotent) membership upsert.
 *   - `jitDefaultWorkspaceId: null` (the default for both `OidcConfig` and a
 *     newly-created `SsoProvider` row) means JIT is OFF: the user account is
 *     created so they can authenticate, but lands with zero workspace
 *     memberships until an existing member invites them — today's Phase-1
 *     behavior, unchanged.
 *   - When set, a `Membership` row is created at `jitDefaultRole` (default
 *     `VIEWER` — an admin must explicitly opt into a higher default).
 */
import type { PrismaService } from '../prisma/prisma.service';
import type { Role } from '@next-lane/shared';

export interface JitProvisioningRule {
  jitDefaultWorkspaceId: string | null;
  jitDefaultRole: Role;
}

/**
 * Auto-creates a `Membership` for `userId` per `rule`, if configured. No-op
 * when `jitDefaultWorkspaceId` is null, or when the referenced workspace no
 * longer exists (defensive — the FK is `onDelete: SetNull` on the provider
 * row itself, but a config snapshot read moments earlier could theoretically
 * be stale). Idempotent via `upsert` — safe to call more than once for the
 * same user/workspace pair even though callers only invoke it for brand-new
 * users.
 */
export async function provisionJitMembership(
  prisma: PrismaService,
  userId: string,
  rule: JitProvisioningRule,
): Promise<void> {
  if (!rule.jitDefaultWorkspaceId) return;

  const workspace = await prisma.workspace.findUnique({
    where: { id: rule.jitDefaultWorkspaceId },
    select: { id: true },
  });
  if (!workspace) return;

  await prisma.membership.upsert({
    where: {
      userId_workspaceId: { userId, workspaceId: rule.jitDefaultWorkspaceId },
    },
    update: {},
    create: {
      userId,
      workspaceId: rule.jitDefaultWorkspaceId,
      role: rule.jitDefaultRole,
    },
  });
}
