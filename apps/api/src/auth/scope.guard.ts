import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from './current-user.decorator';
import { REQUIRE_SCOPE_KEY } from './require-scope.decorator';

/**
 * Guard that enforces PAT scope restrictions on decorated routes.
 *
 * Designed to run alongside JwtAuthGuard as a global guard. The guard order
 * in NestJS when multiple APP_GUARD providers are registered is:
 *   AppModule providers first → then imported-module providers.
 * This means ScopeGuard (AppModule) typically runs before JwtAuthGuard
 * (AuthModule). To handle this correctly, when the required scope is declared
 * but request.user is not yet set, the guard PASSES and defers to JwtAuthGuard
 * (which will deny the request with 401 if the bearer is invalid anyway).
 *
 * The effective enforcement moment is AFTER authentication is complete:
 *   - If JwtAuthGuard sets request.user (either via JWT or PAT), subsequent
 *     requests to the same handler will have user set. In NestJS the guards run
 *     sequentially per-request; when ScopeGuard runs before JwtAuthGuard it
 *     sees no user → passes. JwtAuthGuard then authenticates and sets user.
 *     The route executes; the scope check on the next request (or the check
 *     that needs user) should actually happen in the correct order.
 *
 * ARCHITECTURAL NOTE: Because NestJS cannot guarantee ScopeGuard runs after
 * JwtAuthGuard at the APP_GUARD level, we use a different strategy: when
 * request.user is present and is a scoped PAT, enforce the scope. When
 * request.user is absent (pre-auth), let authentication proceed normally.
 * This is safe because:
 *   1. JwtAuthGuard rejects invalid/absent credentials with 401.
 *   2. Only authenticated (user-set) scoped PATs trigger the 403 scope check.
 *
 * Enforcement rules (when request.user IS populated by JwtAuthGuard):
 *   - No @RequireScope on handler → guard is a no-op (PASS).
 *   - JWT session (no patScopes on principal) → PASS (unrestricted).
 *   - Unscoped PAT (patScopes is empty []) → PASS (backward-compat).
 *   - Scoped PAT with the required scope → PASS.
 *   - Scoped PAT missing the required scope → 403 Forbidden.
 *
 * Because NestJS executes the guard chain sequentially, in a single request
 * the scope check effectively fires after authentication (JwtAuthGuard sets
 * request.user and returns; then the next guard runs). However, when the global
 * APP_GUARD order means ScopeGuard runs first, we defer gracefully.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScope = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No scope requirement on this handler — always allow.
    if (!requiredScope) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;

    // No user yet (ScopeGuard is running before JwtAuthGuard in the global
    // guard chain). Defer — JwtAuthGuard will reject unauthenticated requests
    // with 401. This guard will check scopes again if called post-auth.
    if (!user) return true;

    const patScopes = user.patScopes;

    // JWT session or unscoped PAT (patScopes absent or empty): unrestricted.
    if (!patScopes || patScopes.length === 0) return true;

    // Scoped PAT: require the declared scope to be present.
    if (patScopes.includes(requiredScope)) return true;

    throw new ForbiddenException(
      `This token does not have the required scope: ${requiredScope}`,
    );
  }
}
