import { Module } from '@nestjs/common';
import { GitlabController } from './gitlab.controller';
import { GitlabService } from './gitlab.service';
import { GitlabClient } from './gitlab-client.service';
import { AuditModule } from '../audit/audit.module';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors GithubModule).
@Module({
  imports: [AuditModule],
  controllers: [GitlabController],
  providers: [GitlabService, GitlabClient],
  exports: [GitlabClient],
})
export class GitlabModule {}
