import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  // Export AuditService so other modules can inject it for recording events.
  exports: [AuditService],
})
export class AuditModule {}
