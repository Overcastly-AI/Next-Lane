import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for PATCH /auth/me — update the current user's own profile fields. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}
