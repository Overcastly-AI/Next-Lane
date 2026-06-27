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
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { MoveIssueDto, ListIssuesQueryDto } from './dto/move-issue.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('issues')
@ApiBearerAuth()
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Post()
  @RequireScope('issues:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    return this.issues.create(user.id, dto);
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
}
