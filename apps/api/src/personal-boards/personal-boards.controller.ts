import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PersonalBoardsService } from './personal-boards.service';
import { CreatePersonalColumnDto } from './dto/create-personal-column.dto';
import { UpdatePersonalColumnDto } from './dto/update-personal-column.dto';
import { CreatePersonalCardDto } from './dto/create-personal-card.dto';
import { UpdatePersonalCardDto } from './dto/update-personal-card.dto';
import { PromotePersonalCardDto } from './dto/promote-personal-card.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('personal-boards')
@ApiBearerAuth()
@Controller('me')
export class PersonalBoardsController {
  constructor(private readonly personalBoards: PersonalBoardsService) {}

  // ── Board ────────────────────────────────────────────────────────────────

  /**
   * GET /me/personal-board
   *
   * Returns the caller's personal columns (ordered by `order`) each with their
   * cards (ordered by `rank`). Creates three default columns ("To Do", "Doing",
   * "Done") on first access.
   */
  @Get('personal-board')
  getBoard(@CurrentUser() user: AuthUser) {
    return this.personalBoards.getBoard(user.id);
  }

  // ── Columns ──────────────────────────────────────────────────────────────

  /** POST /me/personal-columns — create a column at the end (order = max+1). */
  @Post('personal-columns')
  createColumn(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePersonalColumnDto,
  ) {
    return this.personalBoards.createColumn(user.id, dto);
  }

  /** PATCH /me/personal-columns/:id — rename or reorder a column. */
  @Patch('personal-columns/:id')
  updateColumn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePersonalColumnDto,
  ) {
    return this.personalBoards.updateColumn(user.id, id, dto);
  }

  /**
   * DELETE /me/personal-columns/:id — delete a column.
   *
   * Cards are cascade-deleted by the database (see PersonalCard.columnId FK).
   * Returns 404 if the column does not belong to the caller.
   */
  @Delete('personal-columns/:id')
  @HttpCode(200)
  deleteColumn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.personalBoards.deleteColumn(user.id, id);
  }

  // ── Cards ────────────────────────────────────────────────────────────────

  /** POST /me/personal-cards — create a card at the end of a column. */
  @Post('personal-cards')
  createCard(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePersonalCardDto,
  ) {
    return this.personalBoards.createCard(user.id, dto);
  }

  /**
   * PATCH /me/personal-cards/:id — edit a card's content and/or move it.
   *
   * `columnId` moves the card to another column. `beforeId` / `afterId` are
   * the neighbor cards used to compute the new fractional-index rank.
   */
  @Patch('personal-cards/:id')
  updateCard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePersonalCardDto,
  ) {
    return this.personalBoards.updateCard(user.id, id, dto);
  }

  /** DELETE /me/personal-cards/:id — delete a card. */
  @Delete('personal-cards/:id')
  @HttpCode(200)
  deleteCard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.personalBoards.deleteCard(user.id, id);
  }

  // ── Promote ──────────────────────────────────────────────────────────────

  /**
   * POST /me/personal-cards/:id/promote — promote a card to a tracked issue.
   *
   * Creates an Issue (type TASK) in the given project from the card's
   * title/notes, then sets the card's `promotedIssueId` to the new issue id.
   * The caller must be a project MEMBER+. Returns `{ card, issue }`.
   */
  @Post('personal-cards/:id/promote')
  promoteCard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PromotePersonalCardDto,
  ) {
    return this.personalBoards.promoteCard(user.id, id, dto);
  }
}
