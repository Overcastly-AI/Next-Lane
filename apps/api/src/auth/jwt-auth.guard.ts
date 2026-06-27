import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ApiTokensService } from '../api-tokens/api-tokens.service';

/** Extract the raw bearer token from the Authorization header, or null. */
function extractBearer(request: { headers?: { authorization?: string } }): string | null {
  const auth = request.headers?.authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiTokens: ApiTokensService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      user?: unknown;
    }>();

    const rawBearer = extractBearer(request);

    // If the bearer token starts with the PAT prefix, validate it as a PAT
    // and skip the standard JWT verification path entirely.
    if (rawBearer && ApiTokensService.isPat(rawBearer)) {
      // Throws UnauthorizedException on invalid/revoked/expired token.
      const user = await this.apiTokens.validateRawToken(rawBearer);
      // Attach the user to the request — same shape as JwtStrategy.validate().
      request.user = user;
      return true;
    }

    // Fall through to the standard Passport JWT strategy.
    const result = await super.canActivate(context);
    if (!result) throw new UnauthorizedException();
    return result as boolean;
  }
}
