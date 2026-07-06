import { Module } from '@nestjs/common';
import { DashboardShareTokensService } from './dashboard-share-tokens.service';
import { DashboardShareTokensController } from './dashboard-share-tokens.controller';

@Module({
  controllers: [DashboardShareTokensController],
  providers: [DashboardShareTokensService],
  exports: [DashboardShareTokensService],
})
export class DashboardShareTokensModule {}
