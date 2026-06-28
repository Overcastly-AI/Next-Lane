import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IssuesService } from './issues.service';
import { WatchersService } from './watchers.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';
import { BulkUpdateIssuesDto } from './dto/bulk-update-issues.dto';

@ApiTags('issues')
@ApiBearerAuth()
@Controller('issues')
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly watchers: WatchersService,
  ) {}

  @Post()
  @RequireScope('issues:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    return this.issues.create(user.id, dto);
  }

  /**
   * Bulk-edit up to 100 issues in a single request. Each issue is updated
   * independently via the same `update()` path as a single PATCH, so per-issue
   * authorization (MEMBER+), ActivityLog, realtime, webhooks, and automation
   * events all fire. Issues the caller cannot access appear in `failed` — the
   * batch never throws a whole-request 403.
   *
   * Route is `POST /issues/bulk` — the static segment `bulk` is unambiguous
   * from the root `POST /issues` (create) and from param routes like
   * `POST /issues/:id/move` (NestJS resolves static > param).
   */
  @Post('bulk')
  @RequireScope('issues:write')
  bulkUpdate(@CurrentUser() user: AuthUser, @Body() dto: BulkUpdateIssuesDto) {
    return this.issues.bulkUpdate(user.id, dto);
  }

  @Get()
  @RequireScope('issues:read')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListIssuesQueryDto) {
    return this.issues.findAll(user.id, query);
  }

  @Get(':id')
  @RequireScope('issues:read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.findOne(user.id, id);
  }

  @Get(':id/activity')
  @RequireScope('issues:read')
  activity(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.getActivity(user.id, id);
  }

  @Patch(':id')
  @RequireScope('issues:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIssueDto,
  ) {
    return this.issues.update(user.id, id, dto);
  }

  @Post(':id/move')
  @RequireScope('issues:write')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveIssueDto,
  ) {
    return this.issues.move(user.id, id, dto);
  }

  @Delete(':id')
  @RequireScope('issues:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.issues.remove(user.id, id);
  }

  // ── Watch toggle ──────────────────────────────────────────────────────────

  /**
   * Subscribe the caller to this issue. Idempotent — calling when already
   * watching returns { watching: true } without error.
   */
  @Post(':id/watch')
  @RequireScope('issues:write')
  watch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.watchers.watch(id, user.id);
  }

  /**
   * Unsubscribe the caller from this issue. Idempotent — calling when not
   * watching returns { watching: false } without error.
   */
  @Delete(':id/watch')
  @RequireScope('issues:write')
  unwatch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.watchers.unwatch(id, user.id);
  }

  /**
   * Return the total watcher count and whether the caller is currently
   * watching this issue. Useful for rendering a watch button with its badge.
   */
  @Get(':id/watchers')
  @RequireScope('issues:read')
  watcherInfo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.watchers.getWatcherInfo(id, user.id);
  }
}
