import { IsEnum } from 'class-validator';
import { Role } from '@next-lane/shared';

/** Body for `PUT /projects/:id/members/:userId/role` — set a project role override. */
export class SetProjectRoleOverrideDto {
  @IsEnum(Role)
  role!: Role;
}
