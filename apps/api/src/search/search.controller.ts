import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

/**
 * Whether this principal may receive knowledge-base page hits in the combined
 * `/search` response. `patScopes` is undefined for JWT sessions and unscoped
 * PATs (both fully unrestricted); a scoped PAT must explicitly hold
 * `pages:read`. Without this, a token scoped to only `issues:read` would get
 * page content back from `/search` even though `/pages/*` and `/search/pages`
 * correctly 403 it.
 */
function canReadPages(user: AuthUser): boolean {
  return !user.patScopes || user.patScopes.includes('pages:read');
}

@ApiTags('search')
@ApiBearerAuth()
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Global cross-project search, scoped to the caller's workspaces.
   *
   * `limit`/`offset` are real server-side paging (per group), and `groups`
   * narrows which groups are computed at all — see `SearchQueryDto`.
   */
  @Get('search')
  @RequireScope('issues:read')
  global(@CurrentUser() user: AuthUser, @Query() query: SearchQueryDto) {
    return this.search.search(user.id, query.q, query.projectId, canReadPages(user), {
      limit: query.limit,
      offset: query.offset,
      groups: query.groups,
    });
  }

  /** Search scoped to a single project the caller can access. */
  @Get('projects/:projectId/search')
  @RequireScope('issues:read')
  inProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: SearchQueryDto,
  ) {
    return this.search.search(user.id, query.q, projectId, canReadPages(user), {
      limit: query.limit,
      offset: query.offset,
      groups: query.groups,
    });
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
    return this.search.searchPagesOnly(user.id, query.q, query.projectId, {
      limit: query.limit,
      offset: query.offset,
    });
  }
}
