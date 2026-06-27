import { SetMetadata } from '@nestjs/common';
import type { PATScope } from '@next-lane/shared';

/**
 * Metadata key used by ScopeGuard to read the required scope from a handler.
 * Internal — prefer the @RequireScope() decorator.
 */
export const REQUIRE_SCOPE_KEY = 'require_pat_scope';

/**
 * Declares that a route handler requires a specific PAT scope when the request
 * is authenticated via a scoped PAT.
 *
 * Enforcement logic (in ScopeGuard):
 *   - JWT sessions (browser logins):      PASS — unrestricted.
 *   - Unscoped PATs (empty scopes []):    PASS — backward-compatible, full owner perms.
 *   - Scoped PATs that include the scope: PASS.
 *   - Scoped PATs missing the scope:      403 Forbidden.
 *
 * Usage:
 *   @RequireScope('issues:write')
 *   @Post()
 *   create(...) { ... }
 */
export const RequireScope = (scope: PATScope) =>
  SetMetadata(REQUIRE_SCOPE_KEY, scope);
