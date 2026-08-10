import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { runWithRequestContext } from './request-context';

/**
 * Opens the async context every request runs inside.
 *
 * Middleware rather than an interceptor because it has to be the OUTERMOST
 * thing: guards run before interceptors, and the guard that authenticates a
 * PAT is what stamps `isApiToken` onto the context. Starting the context in
 * middleware means the store already exists by the time that guard fires, and
 * everything downstream — guards, pipes, the handler, the services it calls —
 * runs inside it.
 *
 * `isApiToken` starts false and is raised by `JwtAuthGuard`. Defaulting to
 * false is the safe direction: the failure mode of a missed stamp is that a
 * lock does not apply to a request that should have been refused, which shows
 * up in the tests, rather than people being locked out of their own project.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    runWithRequestContext({ method: req.method, isApiToken: false }, () =>
      next(),
    );
  }
}
