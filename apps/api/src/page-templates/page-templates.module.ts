import { Module } from '@nestjs/common';
import { PageTemplatesController } from './page-templates.controller';
import { PageTemplatesService } from './page-templates.service';
import { PagesModule } from '../pages/pages.module';

// PagesModule is imported (not re-provided) so `create-page` goes through the
// SAME PagesService the normal create path uses — one implementation of rank
// assignment, version-1 snapshotting, wiki-link and issue-link syncing, and
// the MEMBER authorization on the destination. A private copy here would be a
// second page-creation path guaranteed to drift.
@Module({
  imports: [PagesModule],
  controllers: [PageTemplatesController],
  providers: [PageTemplatesService],
  exports: [PageTemplatesService],
})
export class PageTemplatesModule {}
