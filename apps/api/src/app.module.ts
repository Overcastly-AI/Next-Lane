import { Module } from '@nestjs/common';
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
import { SearchModule } from './search/search.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
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
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
