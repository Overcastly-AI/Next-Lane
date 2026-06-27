import { Global, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// Global so domain services (issues, comments, sprints) can inject
// WebhooksService to dispatch events alongside their realtime emits without
// each module importing WebhooksModule explicitly.
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
