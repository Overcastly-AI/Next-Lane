import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEngineService } from './automation-engine.service';
import { IssuesModule } from '../issues/issues.module';
import { CommentsModule } from '../comments/comments.module';
import { LabelsModule } from '../labels/labels.module';

@Module({
  imports: [
    // Import modules that export the action-target services.
    // IssuesService, CommentsService, LabelsService are all used by the engine
    // for action execution. These modules do NOT import AutomationsModule,
    // so there is no circular dependency.
    IssuesModule,
    CommentsModule,
    LabelsModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationEngineService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
