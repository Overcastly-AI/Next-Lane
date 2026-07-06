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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChecklistService } from './checklist.service';
import {
  CreateChecklistItemDto,
  ReorderChecklistDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('checklist')
@ApiBearerAuth()
@Controller()
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Get('issues/:issueId/checklist')
  @RequireScope('issues:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.checklist.findAll(user.id, issueId);
  }

  @Post('issues/:issueId/checklist')
  @RequireScope('issues:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.checklist.create(user.id, issueId, dto);
  }

  @Put('issues/:issueId/checklist/reorder')
  @RequireScope('issues:write')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: ReorderChecklistDto,
  ) {
    return this.checklist.reorder(user.id, issueId, dto.itemIds);
  }

  @Patch('checklist/:itemId')
  @RequireScope('issues:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.checklist.update(user.id, itemId, dto);
  }

  @Delete('checklist/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('issues:write')
  remove(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.checklist.remove(user.id, itemId);
  }
}
