import { Module } from '@nestjs/common';
import { StandupsController } from './standups.controller';
import { StandupsService } from './standups.service';

@Module({
  controllers: [StandupsController],
  providers: [StandupsService],
  exports: [StandupsService],
})
export class StandupsModule {}
