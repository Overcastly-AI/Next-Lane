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
import { SprintsService } from './sprints.service';
import { CreateSprintDto, UpdateSprintDto } from './dto/sprint.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('sprints')
@ApiBearerAuth()
@Controller()
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  @Get('projects/:projectId/sprints')
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.sprints.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/sprints')
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSprintDto,
  ) {
    return this.sprints.create(user.id, projectId, dto);
  }

  @Patch('sprints/:id')
  @RequireScope('projects:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSprintDto,
  ) {
    return this.sprints.update(user.id, id, dto);
  }

  @Delete('sprints/:id')
  @RequireScope('projects:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sprints.remove(user.id, id);
  }
}
