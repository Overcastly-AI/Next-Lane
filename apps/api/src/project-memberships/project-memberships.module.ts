import { Module } from '@nestjs/common';
import { ProjectMembershipsController } from './project-memberships.controller';
import { ProjectMembershipsService } from './project-memberships.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [ProjectMembershipsController],
  providers: [ProjectMembershipsService],
  exports: [ProjectMembershipsService],
})
export class ProjectMembershipsModule {}
