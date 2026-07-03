import { Module } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GithubClient } from './github-client.service';
import { AuditModule } from '../audit/audit.module';
import { IssuesModule } from '../issues/issues.module';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors WebhooksModule).
// IssuesModule is imported for IssuesService — the auto-transition-on-merge
// path (`GithubService#applyAutoTransition`) reuses `IssuesService.move()`'s
// existing workflow-transition enforcement + automation-bypass flag rather
// than writing `statusId` directly.
@Module({
  imports: [AuditModule, IssuesModule],
  controllers: [GithubController],
  providers: [GithubService, GithubClient],
  exports: [GithubClient],
})
export class GithubModule {}
