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
import { ComponentsService } from './components.service';
import { CreateComponentDto, UpdateComponentDto } from './dto/component.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('components')
@ApiBearerAuth()
@Controller()
export class ComponentsController {
  constructor(private readonly components: ComponentsService) {}

  @Get('projects/:projectId/components')
  @RequireScope('projects:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.components.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/components')
  @RequireScope('projects:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateComponentDto,
  ) {
    return this.components.create(user.id, projectId, dto);
  }

  @Patch('components/:id')
  @RequireScope('projects:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateComponentDto,
  ) {
    return this.components.update(user.id, id, dto);
  }

  @Delete('components/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('projects:write')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.components.remove(user.id, id);
  }
}
