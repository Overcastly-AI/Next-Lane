import { Module } from '@nestjs/common';
import { GiteaController } from './gitea.controller';
import { GiteaService } from './gitea.service';
import { AuditModule } from '../audit/audit.module';

// RealtimeModule is @Global — RealtimeService resolves from the global
// context automatically; no explicit import needed here (mirrors
// GithubModule/GitlabModule). Unlike those two modules, IssuesModule is NOT
// imported — v1 has no auto-transition-on-merge automation (no
// IssuesService.move() call site here), so there's nothing to wire.
@Module({
  imports: [AuditModule],
  controllers: [GiteaController],
  providers: [GiteaService],
})
export class GiteaModule {}
