import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Global interceptor that echoes the pino-http correlation id (`req.id`) back
 * to the caller as an `X-Request-Id` response header.
 *
 * pino-http sets `req.id` in its middleware (runs before NestJS interceptors),
 * so by the time this interceptor executes the id is always populated.
 *
 * Using an interceptor (rather than a NestMiddleware) ensures we are inside
 * the full NestJS request pipeline, which guarantees pino-http has run.
 * The `tap` on the returned Observable sets the header when the handler
 * completes (before the serialised response is written).
 *
 * Note: HealthController also sets this header directly on its error (503)
 * path to handle the case where an exception short-circuits the interceptor.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();

    if (req.id) {
      res.setHeader('X-Request-Id', req.id);
    }

    return next.handle().pipe(
      tap(() => {
        // Header is already set before handle() above. The tap is a no-op
        // here but keeps the interceptor idiomatic for future use (e.g.
        // timing metrics could be added here).
      }),
    );
  }
}
