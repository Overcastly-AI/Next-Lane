import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PagesService } from './pages.service';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { MovePageDto } from './dto/move-page.dto';
import { ListPageVersionsQueryDto } from './dto/list-page-versions.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('pages')
@ApiBearerAuth()
@Controller()
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  // ── CRUD + tree ───────────────────────────────────────────────────────────

  @Post('projects/:projectId/pages')
  @RequireScope('pages:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.pages.create(user.id, projectId, dto);
  }

  @Get('projects/:projectId/pages/tree')
  @RequireScope('pages:read')
  tree(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.pages.tree(user.id, projectId);
  }

  @Get('projects/:projectId/pages/graph')
  @RequireScope('pages:read')
  graph(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.pages.graph(user.id, projectId);
  }

  @Get('pages/:id')
  @RequireScope('pages:read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pages.findOne(user.id, id);
  }

  @Patch('pages/:id')
  @RequireScope('pages:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pages.update(user.id, id, dto);
  }

  @Delete('pages/:id')
  @RequireScope('pages:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pages.remove(user.id, id);
  }

  // ── Move / reorder ───────────────────────────────────────────────────────

  @Post('pages/:id/move')
  @RequireScope('pages:write')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MovePageDto,
  ) {
    return this.pages.move(user.id, id, dto);
  }

  // ── Version history ──────────────────────────────────────────────────────

  @Get('pages/:id/versions')
  @RequireScope('pages:read')
  listVersions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListPageVersionsQueryDto,
  ) {
    return this.pages.listVersions(user.id, id, query);
  }

  @Get('pages/:id/versions/:n')
  @RequireScope('pages:read')
  getVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
  ) {
    return this.pages.getVersion(user.id, id, n);
  }

  @Post('pages/:id/versions/:n/restore')
  @RequireScope('pages:write')
  restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('n', ParseIntPipe) n: number,
  ) {
    return this.pages.restoreVersion(user.id, id, n);
  }

  // ── Backlinks ────────────────────────────────────────────────────────────

  @Get('pages/:id/backlinks')
  @RequireScope('pages:read')
  backlinks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.pages.backlinks(user.id, id);
  }
}
