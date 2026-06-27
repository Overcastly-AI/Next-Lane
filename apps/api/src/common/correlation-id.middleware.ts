import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Reflects the pino-http correlation id (stored on `req.id`) back to the
 * caller as an `X-Request-Id` response header.
 *
 * pino-http assigns a correlation id to every request (see `genReqId` in
 * `LoggerModule.forRoot`): it reuses the incoming `X-Request-Id` header when
 * present, otherwise generates a UUID v4.  nestjs-pino registers pino-http as
 * a module-level middleware which runs early in the Express middleware chain,
 * BEFORE NestJS module middlewares like this one.  By the time this handler
 * is invoked `req.id` is already populated, so we can safely copy it to the
 * response header.
 *
 * Registering this as a NestJS module middleware (via AppModule.configure)
 * rather than via `app.use()` in main.ts guarantees the correct ordering:
 * global Express middlewares (helmet, app.use) run first → nestjs-pino runs
 * → this middleware runs with req.id available → route handlers fire.
 *
 * The HealthController also sets the header explicitly on error (503) paths
 * where response handling may bypass the normal pipeline.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    if (req.id) {
      res.setHeader('X-Request-Id', req.id);
    }
    next();
  }
}
