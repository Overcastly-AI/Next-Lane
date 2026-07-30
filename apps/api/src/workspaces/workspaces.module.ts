import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { AuditModule } from '../audit/audit.module';
// For seeding the built-in doc templates into a brand-new workspace.
// No cycle: PageTemplatesModule -> PagesModule, and PagesModule imports nothing.
import { PageTemplatesModule } from '../page-templates/page-templates.module';

@Module({
  imports: [AuditModule, PageTemplatesModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
