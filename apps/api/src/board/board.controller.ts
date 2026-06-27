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
import { BoardService } from './board.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('board')
@ApiBearerAuth()
@Controller()
export class BoardController {
  constructor(private readonly board: BoardService) {}

  /** List all boards for a project (VIEWER+). */
  @Get('projects/:projectId/boards')
  listBoards(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.board.listBoards(user.id, projectId);
  }

  /** Create a new board in a project (ADMIN/MEMBER). */
  @Post('projects/:projectId/boards')
  createBoard(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBoardDto,
  ) {
    return this.board.createBoard(user.id, projectId, dto);
  }

  /**
   * Get the default board for a project (legacy endpoint).
   * Lazily creates a default KANBAN board if none exists.
   */
  @Get('projects/:projectId/board')
  getBoard(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.board.getBoard(user.id, projectId);
  }

  /** Get a specific board by id (VIEWER+). */
  @Get('boards/:boardId')
  getBoardById(
    @CurrentUser() user: AuthUser,
    @Param('boardId') boardId: string,
  ) {
    return this.board.getBoardById(user.id, boardId);
  }

  /** Update a board's metadata (ADMIN/MEMBER). */
  @Patch('boards/:boardId')
  updateBoard(
    @CurrentUser() user: AuthUser,
    @Param('boardId') boardId: string,
    @Body() dto: UpdateBoardDto,
  ) {
    return this.board.updateBoard(user.id, boardId, dto);
  }

  /** Delete a board (ADMIN/MEMBER). Refuses if default or only board. */
  @Delete('boards/:boardId')
  deleteBoard(
    @CurrentUser() user: AuthUser,
    @Param('boardId') boardId: string,
  ) {
    return this.board.deleteBoard(user.id, boardId);
  }
}
