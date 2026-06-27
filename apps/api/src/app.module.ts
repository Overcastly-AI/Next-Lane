import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigurableThrottlerGuard } from './common/configurable-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
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
import { HealthController } from './health.controller';

@Module({
  imports: [
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
  ],
  controllers: [HealthController],
  providers: [
    // Global throttle guard: enforces ThrottlerModule limits on every route
    // (skippable via RATE_LIMIT_DISABLED for shared-IP deployments / tests).
    { provide: APP_GUARD, useClass: ConfigurableThrottlerGuard },
  ],
})
export class AppModule {}
