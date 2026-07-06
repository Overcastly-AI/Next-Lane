import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';
import { ReportsModule } from '../reports/reports.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ReportsModule, RealtimeModule],
  controllers: [DashboardsController],
  providers: [DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
