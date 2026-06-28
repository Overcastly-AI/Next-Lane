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
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('custom-fields')
@ApiBearerAuth()
@Controller()
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  @Get('projects/:projectId/custom-fields')
  findAll(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    return this.customFields.findAll(user.id, projectId);
  }

  @Post('projects/:projectId/custom-fields')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.customFields.create(user.id, projectId, dto);
  }

  @Patch('custom-fields/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.customFields.update(user.id, id, dto);
  }

  @Delete('custom-fields/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customFields.remove(user.id, id);
  }
}
