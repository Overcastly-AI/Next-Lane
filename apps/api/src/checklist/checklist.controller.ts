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

@ApiTags('checklist')
@ApiBearerAuth()
@Controller()
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Get('issues/:issueId/checklist')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
  ) {
    return this.checklist.findAll(user.id, issueId);
  }

  @Post('issues/:issueId/checklist')
  create(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.checklist.create(user.id, issueId, dto);
  }

  @Put('issues/:issueId/checklist/reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: ReorderChecklistDto,
  ) {
    return this.checklist.reorder(user.id, issueId, dto.itemIds);
  }

  @Patch('checklist/:itemId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.checklist.update(user.id, itemId, dto);
  }

  @Delete('checklist/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.checklist.remove(user.id, itemId);
  }
}
