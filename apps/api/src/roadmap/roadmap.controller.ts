import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoadmapService } from './roadmap.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('roadmap')
@ApiBearerAuth()
@Controller()
export class RoadmapController {
  constructor(private readonly roadmap: RoadmapService) {}

  /** Roadmap timeline: epics (with derived windows + progress) and dated sprints. */
  @Get('projects/:projectId/roadmap')
  @RequireScope('projects:read')
  getRoadmap(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.roadmap.getRoadmap(user.id, projectId);
  }

  /**
   * Children of one epic, for expanding a roadmap row. Split from the payload
   * above so a 500-epic project doesn't pay for children nobody opened.
   */
  @Get('projects/:projectId/roadmap/epics/:epicId/children')
  @RequireScope('projects:read')
  getEpicChildren(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('epicId') epicId: string,
  ) {
    return this.roadmap.getEpicChildren(user.id, projectId, epicId);
  }
}
