/**
 * Unit tests for ScopeGuard.
 *
 * Scenarios:
 *   1. No @RequireScope on handler → PASS (guard is a no-op).
 *   2. JWT session principal (no patScopes) → PASS (unrestricted).
 *   3. Unscoped PAT (patScopes = []) → PASS (backward-compat, full perms).
 *   4. Scoped PAT that has the required scope → PASS.
 *   5. Scoped PAT missing the required scope → 403 ForbiddenException.
 *   6. No user on request → 403 ForbiddenException.
 */

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ScopeGuard } from './scope.guard';
import { REQUIRE_SCOPE_KEY } from './require-scope.decorator';
import type { AuthUser } from './current-user.decorator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReflector(scope: string | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(scope),
  } as unknown as Reflector;
}

function makeContext(user: AuthUser | undefined): {
  getHandler: () => unknown;
  getClass: () => unknown;
  switchToHttp: () => { getRequest: () => { user: AuthUser | undefined } };
} {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScopeGuard', () => {
  it('passes when no @RequireScope is set on the handler', () => {
    const guard = new ScopeGuard(makeReflector(undefined));
    const ctx = makeContext({ id: 'u1', email: 'a@b.com', name: 'A' });
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('passes for a JWT session principal (no patScopes property)', () => {
    const guard = new ScopeGuard(makeReflector('issues:write'));
    // JWT principal — patScopes absent
    const user: AuthUser = { id: 'u1', email: 'a@b.com', name: 'A' };
    const ctx = makeContext(user);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('passes for an unscoped PAT (patScopes = [])', () => {
    const guard = new ScopeGuard(makeReflector('issues:write'));
    const user: AuthUser = { id: 'u1', email: 'a@b.com', name: 'A', patScopes: [] };
    const ctx = makeContext(user);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('passes for a scoped PAT that includes the required scope', () => {
    const guard = new ScopeGuard(makeReflector('issues:write'));
    const user: AuthUser = {
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      patScopes: ['issues:read', 'issues:write'],
    };
    const ctx = makeContext(user);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('throws ForbiddenException for a scoped PAT missing the required scope', () => {
    const guard = new ScopeGuard(makeReflector('issues:write'));
    const user: AuthUser = {
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      patScopes: ['issues:read'], // has read but NOT write
    };
    const ctx = makeContext(user);
    expect(() => guard.canActivate(ctx as never)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the request has no user at all', () => {
    const guard = new ScopeGuard(makeReflector('issues:write'));
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx as never)).toThrow(ForbiddenException);
  });

  it('reflector is called with REQUIRE_SCOPE_KEY', () => {
    const reflector = makeReflector('webhooks:write');
    const guard = new ScopeGuard(reflector);
    const user: AuthUser = {
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      patScopes: ['webhooks:write'],
    };
    const ctx = makeContext(user);
    guard.canActivate(ctx as never);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRE_SCOPE_KEY,
      expect.any(Array),
    );
  });
});
