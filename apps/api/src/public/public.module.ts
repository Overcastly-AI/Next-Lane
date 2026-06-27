import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { ShareTokensModule } from '../share-tokens/share-tokens.module';

@Module({
  imports: [ShareTokensModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
