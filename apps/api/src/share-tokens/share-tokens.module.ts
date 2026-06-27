import { Module } from '@nestjs/common';
import { ShareTokensService } from './share-tokens.service';
import { ShareTokensController } from './share-tokens.controller';

@Module({
  controllers: [ShareTokensController],
  providers: [ShareTokensService],
  exports: [ShareTokensService],
})
export class ShareTokensModule {}
