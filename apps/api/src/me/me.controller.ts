import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MeService } from './me.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** The caller's personal work across all their workspaces, grouped. */
  @Get('work')
  work(@CurrentUser() user: AuthUser) {
    return this.me.getMyWork(user.id);
  }
}
