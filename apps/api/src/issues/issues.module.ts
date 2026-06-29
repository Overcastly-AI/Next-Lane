import { forwardRef, Module } from '@nestjs/common';
import { IssuesController } from './issues.controller';
import { IssuesCsvController } from './issues-csv.controller';
import { IssuesImportController } from './issues-import.controller';
import { IssuesService } from './issues.service';
import { IssuesImportService } from './issues-import.service';
import { WatchersService } from './watchers.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { WorkflowModule } from '../workflows/workflow.module';

@Module({
  imports: [
    RealtimeModule,
    NotificationsModule,
    CustomFieldsModule,
    forwardRef(() => WorkflowModule),
  ],
  controllers: [IssuesController, IssuesCsvController, IssuesImportController],
  providers: [IssuesService, IssuesImportService, WatchersService],
  exports: [IssuesService, IssuesImportService, WatchersService],
})
export class IssuesModule {}
