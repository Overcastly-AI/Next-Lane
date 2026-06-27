import { Global, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AuditModule } from '../audit/audit.module';

// RedisModule is @Global — the REDIS_CLIENT token is resolved from the global
// context automatically; no explicit import needed here.

// Global so domain services (issues, comments, sprints) can inject
// WebhooksService to dispatch events alongside their realtime emits without
// each module importing WebhooksModule explicitly.
@Global()
@Module({
  imports: [AuditModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
