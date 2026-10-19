import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CommentResponse } from '../common/dto/api-responses.dto';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('issues/:issueId/comments')
  @ApiOkResponse({ type: CommentResponse, isArray: true })
  @RequireScope('comments:read')
  findAll(@CurrentUser() user: AuthUser, @Param('issueId') issueId: string) {
    return this.comments.findAll(user.id, issueId);
  }

  @Post('issues/:issueId/comments')
  @ApiCreatedResponse({ type: CommentResponse })
  @RequireScope('comments:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(user.id, issueId, dto);
  }

  @Patch('comments/:id')
  @ApiOkResponse({ type: CommentResponse })
  @RequireScope('comments:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(user.id, id, dto);
  }

  @Delete('comments/:id')
  @RequireScope('comments:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.remove(user.id, id);
  }
}
