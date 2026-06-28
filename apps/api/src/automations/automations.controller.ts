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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AutomationsService } from './automations.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { ListRunsQueryDto } from './dto/list-runs-query.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('automations')
@ApiBearerAuth()
@Controller()
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  // ── Rules ─────────────────────────────────────────────────────────────────

  @Get('projects/:projectId/automations')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.automations.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/automations')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.automations.create(user.id, projectId, dto);
  }

  @Get('projects/:projectId/automations/runs')
  findProjectRuns(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query() query: ListRunsQueryDto,
  ) {
    return this.automations.findRuns(user.id, projectId, query.limit);
  }

  @Get('projects/:projectId/automations/:ruleId')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('ruleId') ruleId: string,
  ) {
    return this.automations.findOne(user.id, ruleId);
  }

  @Patch('projects/:projectId/automations/:ruleId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automations.update(user.id, ruleId, dto);
  }

  @Delete('projects/:projectId/automations/:ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('ruleId') ruleId: string,
  ) {
    return this.automations.remove(user.id, ruleId);
  }

  @Get('projects/:projectId/automations/:ruleId/runs')
  findRuleRuns(
    @CurrentUser() user: AuthUser,
    @Param('ruleId') ruleId: string,
    @Query() query: ListRunsQueryDto,
  ) {
    return this.automations.findRuleRuns(user.id, ruleId, query.limit);
  }
}
