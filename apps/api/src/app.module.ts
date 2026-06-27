import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
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
          ignore: (req) => (req as { url?: string }).url === '/health',
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
  ],
  controllers: [HealthController],
  providers: [
    // Global throttle guard: enforces ThrottlerModule limits on every route
    // (skippable via RATE_LIMIT_DISABLED for shared-IP deployments / tests).
    { provide: APP_GUARD, useClass: ConfigurableThrottlerGuard },
  ],
})
export class AppModule {}
