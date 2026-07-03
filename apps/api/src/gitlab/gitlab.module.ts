import { Module } from '@nestjs/common';
import { GitlabController } from './gitlab.controller';
import { GitlabService } from './gitlab.service';
import { GitlabClient } from './gitlab-client.service';
import { AuditModule } from '../audit/audit.module';
import { IssuesModule } from '../issues/issues.module';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors GithubModule).
// IssuesModule is imported for IssuesService — see github.module.ts's
// comment for the auto-transition-on-merge rationale (mirrored exactly).
@Module({
  imports: [AuditModule, IssuesModule],
  controllers: [GitlabController],
  providers: [GitlabService, GitlabClient],
  exports: [GitlabClient],
})
export class GitlabModule {}
