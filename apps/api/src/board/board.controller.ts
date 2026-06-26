import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BoardService } from './board.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('board')
@ApiBearerAuth()
@Controller()
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get('projects/:projectId/board')
  getBoard(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.board.getBoard(user.id, projectId);
  }
}
