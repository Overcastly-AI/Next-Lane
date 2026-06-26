import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('search')
@ApiBearerAuth()
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Global cross-project search, scoped to the caller's workspaces. */
  @Get('search')
  global(@CurrentUser() user: AuthUser, @Query() query: SearchQueryDto) {
    return this.search.search(user.id, query.q, query.projectId);
  }

  /** Search scoped to a single project the caller can access. */
  @Get('projects/:projectId/search')
  inProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: SearchQueryDto,
  ) {
    return this.search.search(user.id, query.q, projectId);
  }
}
