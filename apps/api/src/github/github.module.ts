import { Module } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GithubClient } from './github-client.service';
import { AuditModule } from '../audit/audit.module';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors WebhooksModule).
@Module({
  imports: [AuditModule],
  controllers: [GithubController],
  providers: [GithubService, GithubClient],
  exports: [GithubClient],
})
export class GithubModule {}
