import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('search')
@ApiBearerAuth()
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Global cross-project search, scoped to the caller's workspaces. */
  @Get('search')
  @RequireScope('issues:read')
  global(@CurrentUser() user: AuthUser, @Query() query: SearchQueryDto) {
    return this.search.search(user.id, query.q, query.projectId);
  }

  /** Search scoped to a single project the caller can access. */
  @Get('projects/:projectId/search')
  @RequireScope('issues:read')
  inProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: SearchQueryDto,
  ) {
    return this.search.search(user.id, query.q, projectId);
  }

  /**
   * Pages-only full-text search, gated by `pages:read` (NOT `issues:read`) so
   * a knowledge-base-scoped token — e.g. an agent minted only for the wiki —
   * can search pages without being granted the issue surface. The combined
   * `GET /search` deliberately stays `issues:read` because its response
   * includes issue hits; this route returns pages only, so there is nothing
   * cross-surface to leak.
   */
  @Get('search/pages')
  @RequireScope('pages:read')
  pagesOnly(@CurrentUser() user: AuthUser, @Query() query: SearchQueryDto) {
    return this.search.searchPagesOnly(user.id, query.q, query.projectId);
  }
}
