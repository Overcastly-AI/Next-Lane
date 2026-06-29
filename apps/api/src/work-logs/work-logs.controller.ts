import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WorkLogsService } from './work-logs.service';
import { CreateWorkLogDto, UpdateWorkLogDto } from './dto/work-log.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('work-logs')
@ApiBearerAuth()
@Controller()
export class WorkLogsController {
  constructor(private readonly workLogs: WorkLogsService) {}

  /** GET /issues/:issueId/worklogs — list work logs for an issue (VIEWER+). */
  @Get('issues/:issueId/worklogs')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.workLogs.findAll(user.id, issueId);
  }

  /** POST /issues/:issueId/worklogs — log time against an issue (MEMBER+). */
  @Post('issues/:issueId/worklogs')
  create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: CreateWorkLogDto,
  ) {
    return this.workLogs.create(user.id, issueId, dto);
  }

  /** PATCH /worklogs/:id — update a work log (author or project admin). */
  @Patch('worklogs/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') workLogId: string,
    @Body() dto: UpdateWorkLogDto,
  ) {
    return this.workLogs.update(user.id, workLogId, dto);
  }

  /** DELETE /worklogs/:id — delete a work log (author or project admin). 204. */
  @Delete('worklogs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') workLogId: string,
  ) {
    return this.workLogs.remove(user.id, workLogId);
  }
}
