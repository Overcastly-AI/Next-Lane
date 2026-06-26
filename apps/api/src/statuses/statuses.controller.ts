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
import { StatusesService } from './statuses.service';
import { CreateStatusDto, UpdateStatusDto } from './dto/status.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('statuses')
@ApiBearerAuth()
@Controller()
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  @Get('projects/:projectId/statuses')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.statuses.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/statuses')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateStatusDto,
  ) {
    return this.statuses.create(user.id, projectId, dto);
  }

  @Patch('statuses/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.statuses.update(user.id, id, dto);
  }

  @Delete('statuses/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statuses.remove(user.id, id);
  }
}
