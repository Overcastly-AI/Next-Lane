import { Module } from '@nestjs/common';
import { AgentContextController } from './agent-context.controller';
import { AgentContextService } from './agent-context.service';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors GithubModule).
@Module({
  controllers: [AgentContextController],
  providers: [AgentContextService],
  exports: [AgentContextService],
})
export class AgentContextModule {}
