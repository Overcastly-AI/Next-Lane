import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * GET /users?q=<text> — optional server-side name/email substring filter
   * (Agent Experience Round 2 fold-in), scoped to the caller's co-members.
   */
  @Get()
  @RequireScope('workspaces:read')
  findAll(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return this.users.findAll(user.id, q);
  }

  @Get(':id')
  @RequireScope('workspaces:read')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.findOne(user.id, id);
  }
}
