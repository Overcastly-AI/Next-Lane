import { Module } from '@nestjs/common';
import { PokerController } from './poker.controller';
import { PokerService } from './poker.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [PokerController],
  providers: [PokerService],
  exports: [PokerService],
})
export class PokerModule {}
