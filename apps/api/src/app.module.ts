import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
    // Global rate-limit: 100 requests per 60 seconds per IP.
    // Auth routes apply a stricter 10 req/min limit via @Throttle() on the controller.
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60000, // 60 seconds in ms
        limit: 100,
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
    // Global throttle guard: enforces ThrottlerModule limits on every route.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
