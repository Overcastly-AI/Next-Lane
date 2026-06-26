import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
