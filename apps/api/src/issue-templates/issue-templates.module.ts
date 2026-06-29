import { Module } from '@nestjs/common';
import { IssueTemplatesController } from './issue-templates.controller';
import { IssueTemplatesService } from './issue-templates.service';
import { IssuesModule } from '../issues/issues.module';

@Module({
  imports: [IssuesModule],
  controllers: [IssueTemplatesController],
  providers: [IssueTemplatesService],
  exports: [IssueTemplatesService],
})
export class IssueTemplatesModule {}
