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
import { SavedFiltersService } from './saved-filters.service';
import { CreateSavedFilterDto, UpdateSavedFilterDto } from './dto/saved-filter.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('saved-filters')
@ApiBearerAuth()
@Controller()
export class SavedFiltersController {
  constructor(private readonly savedFilters: SavedFiltersService) {}

  @Get('projects/:projectId/saved-filters')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.savedFilters.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/saved-filters')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSavedFilterDto,
  ) {
    return this.savedFilters.create(user.id, projectId, dto);
  }

  @Patch('saved-filters/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSavedFilterDto,
  ) {
    return this.savedFilters.update(user.id, id, dto);
  }

  @Delete('saved-filters/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.savedFilters.remove(user.id, id);
  }
}
