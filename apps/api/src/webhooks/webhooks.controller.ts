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
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('projects/:projectId/webhooks')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.webhooks.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/webhooks')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooks.create(user.id, projectId, dto);
  }

  @Patch('projects/:projectId/webhooks/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(user.id, id, dto);
  }

  @Delete('projects/:projectId/webhooks/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.remove(user.id, id);
  }

  @Get('projects/:projectId/webhooks/:id/deliveries')
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.deliveries(user.id, id);
  }

  @Post('projects/:projectId/webhooks/:id/test')
  sendTest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.sendTest(user.id, id);
  }
}
