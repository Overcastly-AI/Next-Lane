import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { CorrelationIdInterceptor } from './common/correlation-id.interceptor';
import { ConfigurableThrottlerGuard } from './common/configurable-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ProjectsModule } from './projects/projects.module';
import { StatusesModule } from './statuses/statuses.module';
import { IssuesModule } from './issues/issues.module';
import { CommentsModule } from './comments/comments.module';
import { LabelsModule } from './labels/labels.module';
import { SprintsModule } from './sprints/sprints.module';
import { BoardModule } from './board/board.module';
import { ReportsModule } from './reports/reports.module';
import { RoadmapModule } from './roadmap/roadmap.module';
import { SearchModule } from './search/search.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ApiTokensModule } from './api-tokens/api-tokens.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { ShareTokensModule } from './share-tokens/share-tokens.module';
import { PublicModule } from './public/public.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { SavedFiltersModule } from './saved-filters/saved-filters.module';
import { PokerModule } from './poker/poker.module';
import { IssueLinksModule } from './issue-links/issue-links.module';
import { HealthController } from './health.controller';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    // Structured request logging via nestjs-pino / pino-http.
    // In development: pretty-printed to stdout (pino-pretty transport).
    // In production: JSON lines on stdout (compatible with log aggregators).
    // Sensitive fields (Authorization header, cookies, password, token) are
    // redacted so request logs never leak secrets.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Pretty-print in non-production for human readability; JSON in prod.
        transport: isProd
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },

        // ── Request correlation id ──────────────────────────────────────────
        // Reuse the incoming `X-Request-Id` header when present (e.g. from an
        // upstream proxy or client-side retry logic); otherwise generate a new
        // UUID v4.  The resulting id is:
        //   • bound to `req.id` by pino-http (visible in every log line
        //     emitted during the request via the `reqId` field)
        //   • echoed back in the `X-Request-Id` response header via
        //     customSuccessMessage / customErrorMessage (below) AND set by
        //     HealthController for the unauthenticated /health path.
        genReqId(req: IncomingMessage) {
          const incoming = (req.headers as Record<string, string | string[] | undefined>)[
            'x-request-id'
          ];
          if (typeof incoming === 'string' && incoming.length > 0) return incoming;
          return randomUUID();
        },

        // Attach the correlation id to every response via a header so callers
        // can match a request to a log entry without server-log access.
        customSuccessMessage(_req, _res) {
          return 'request completed';
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customProps(req: any, _res: any) {
          // Surface `reqId` under the standard `requestId` key so log
          // consumers that follow the common structured-logging convention
          // find it without knowing pino-http's internal field name.
          return { requestId: req.id as string };
        },

        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'req.body.newPassword',
          ],
          censor: '[REDACTED]',
        },
        // Quiet down health-check noise in logs.
        autoLogging: {
          ignore: (req) => {
            const url = (req as { url?: string }).url ?? '';
            // Silence both readiness (/health) and liveness (/health/live).
            return url === '/health' || url === '/health/live';
          },
        },
      },
    }),
    // Global rate-limit (per IP). Defaults to 100 req / 60s; tune via env.
    // Auth routes apply a stricter limit via @Throttle() on the controller.
    // Set RATE_LIMIT_DISABLED=true to switch off entirely (shared-IP / tests).
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: Number(process.env.THROTTLE_TTL) || 60000, // window in ms
        limit: Number(process.env.THROTTLE_LIMIT) || 100,
      },
    ]),
    PrismaModule,
    RedisModule,
    RealtimeModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    ProjectsModule,
    StatusesModule,
    IssuesModule,
    CommentsModule,
    LabelsModule,
    SprintsModule,
    BoardModule,
    ReportsModule,
    RoadmapModule,
    SearchModule,
    MeModule,
    NotificationsModule,
    WebhooksModule,
    ApiTokensModule,
    AttachmentsModule,
    AuditModule,
    MailModule,
    ShareTokensModule,
    PublicModule,
    CustomFieldsModule,
    SavedFiltersModule,
    PokerModule,
    IssueLinksModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global throttle guard: enforces ThrottlerModule limits on every route
    // (skippable via RATE_LIMIT_DISABLED for shared-IP deployments / tests).
    { provide: APP_GUARD, useClass: ConfigurableThrottlerGuard },
    // Global interceptor: echoes the pino-http correlation id (req.id) back
    // to the caller via the X-Request-Id response header.  Runs inside the
    // NestJS request pipeline, after pino-http middleware has set req.id.
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * Wire the `CorrelationIdMiddleware` across every route.
   *
   * NestJS module middlewares run inside the NestJS middleware pipeline —
   * AFTER nestjs-pino (which sets `req.id` via its `genReqId` hook) and
   * AFTER global Express middlewares registered via `app.use()` in main.ts.
   * This ordering guarantees `req.id` is populated by the time
   * `CorrelationIdMiddleware` echoes it back as `X-Request-Id`.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
