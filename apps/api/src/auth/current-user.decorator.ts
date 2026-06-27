import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /**
   * PAT scopes attached to this principal. Present only when authenticated via
   * a scoped PAT (non-empty scopes array). Absent (undefined) for JWT sessions
   * and unscoped PATs — both are treated as fully unrestricted.
   */
  patScopes?: string[];
}

/** Injects the authenticated user (set by JwtStrategy or JwtAuthGuard) into a route handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
