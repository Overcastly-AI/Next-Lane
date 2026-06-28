import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PokerService } from './poker.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import {
  CreatePokerSessionDto,
  UpdatePokerSessionDto,
  AddPokerItemDto,
  CastVoteDto,
  CommitEstimateDto,
} from './dto/poker.dto';

@ApiTags('poker')
@ApiBearerAuth()
@Controller()
export class PokerController {
  constructor(private readonly poker: PokerService) {}

  // ── Sessions scoped to a project ──────────────────────────────────────────

  /** POST /projects/:projectId/poker-sessions — create a new session (MEMBER+) */
  @Post('projects/:projectId/poker-sessions')
  createSession(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePokerSessionDto,
  ) {
    return this.poker.createSession(user.id, projectId, dto);
  }

  /** GET /projects/:projectId/poker-sessions — list sessions most-recent first (VIEWER+) */
  @Get('projects/:projectId/poker-sessions')
  listSessions(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.poker.listSessions(user.id, projectId);
  }

  // ── Session by id ─────────────────────────────────────────────────────────

  /** GET /poker-sessions/:id — fetch session with items + masked votes (VIEWER+) */
  @Get('poker-sessions/:id')
  getSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.poker.getSession(user.id, id);
  }

  /** PATCH /poker-sessions/:id — update name/state/activeItemId (MEMBER+) */
  @Patch('poker-sessions/:id')
  updateSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePokerSessionDto,
  ) {
    return this.poker.updateSession(user.id, id, dto);
  }

  // ── Items scoped to a session ─────────────────────────────────────────────

  /** POST /poker-sessions/:id/items — add an item (MEMBER+) */
  @Post('poker-sessions/:id/items')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('id') sessionId: string,
    @Body() dto: AddPokerItemDto,
  ) {
    return this.poker.addItem(user.id, sessionId, dto);
  }

  // ── Items by item id ──────────────────────────────────────────────────────

  /** DELETE /poker-items/:itemId — remove an item (MEMBER+) */
  @Delete('poker-items/:itemId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
  ) {
    return this.poker.removeItem(user.id, itemId);
  }

  /** POST /poker-items/:itemId/vote — cast or update a vote (MEMBER+) */
  @Post('poker-items/:itemId/vote')
  castVote(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() dto: CastVoteDto,
  ) {
    return this.poker.castVote(user.id, itemId, dto);
  }

  /** POST /poker-items/:itemId/reveal — reveal an item's votes (MEMBER+) */
  @Post('poker-items/:itemId/reveal')
  revealItem(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
  ) {
    return this.poker.revealItem(user.id, itemId);
  }

  /** POST /poker-items/:itemId/commit — commit final estimate (MEMBER+) */
  @Post('poker-items/:itemId/commit')
  commitEstimate(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() dto: CommitEstimateDto,
  ) {
    return this.poker.commitEstimate(user.id, itemId, dto);
  }
}
