import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ShareTokensModule } from '../share-tokens/share-tokens.module';
import { DashboardShareTokensModule } from '../dashboard-share-tokens/dashboard-share-tokens.module';
import { DashboardsModule } from '../dashboards/dashboards.module';

@Module({
  imports: [ShareTokensModule, DashboardShareTokensModule, DashboardsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
