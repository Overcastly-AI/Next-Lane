import { Module } from '@nestjs/common';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors
// AgentContextModule/GithubModule).
@Module({
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
