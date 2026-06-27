import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

function extractIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('projects/:projectId/webhooks')
  @RequireScope('webhooks:read')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.webhooks.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/webhooks')
  @RequireScope('webhooks:write')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWebhookDto,
    @Req() req: Request,
  ) {
    return this.webhooks.create(user.id, projectId, dto, extractIp(req));
  }

  @Patch('projects/:projectId/webhooks/:id')
  @RequireScope('webhooks:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Req() req: Request,
  ) {
    return this.webhooks.update(user.id, id, dto, extractIp(req));
  }

  @Delete('projects/:projectId/webhooks/:id')
  @RequireScope('webhooks:write')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.webhooks.remove(user.id, id, extractIp(req));
  }

  @Get('projects/:projectId/webhooks/:id/deliveries')
  @RequireScope('webhooks:read')
  deliveries(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.deliveries(user.id, id);
  }

  @Post('projects/:projectId/webhooks/:id/test')
  @RequireScope('webhooks:write')
  sendTest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.webhooks.sendTest(user.id, id);
  }
}
