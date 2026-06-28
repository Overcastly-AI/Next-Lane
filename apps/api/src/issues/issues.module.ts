import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesCsvController } from './issues-csv.controller';
import { IssuesService } from './issues.service';
import { WatchersService } from './watchers.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';

@Module({
  imports: [RealtimeModule, NotificationsModule, CustomFieldsModule],
  controllers: [IssuesController, IssuesCsvController],
  providers: [IssuesService, WatchersService],
  exports: [IssuesService, WatchersService],
})
export class IssuesModule {}
