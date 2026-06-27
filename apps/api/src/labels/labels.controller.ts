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
import { LabelsService } from './labels.service';
import { CreateLabelDto, UpdateLabelDto, AddIssueLabelDto } from './dto/label.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('labels')
@ApiBearerAuth()
@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('projects/:projectId/labels')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.labels.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/labels')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labels.create(user.id, projectId, dto);
  }

  @Patch('labels/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labels.update(user.id, id, dto);
  }

  @Delete('labels/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.labels.remove(user.id, id);
  }

  @Post('issues/:issueId/labels')
  addToIssue(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Body() dto: AddIssueLabelDto,
  ) {
    return this.labels.addToIssue(user.id, issueId, dto.labelId);
  }

  @Delete('issues/:issueId/labels/:labelId')
  removeFromIssue(
    @CurrentUser() user: AuthUser,
    @Param('issueId') issueId: string,
    @Param('labelId') labelId: string,
  ) {
    return this.labels.removeFromIssue(user.id, issueId, labelId);
  }
}
