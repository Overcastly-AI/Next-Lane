import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  /** The raw reset token from the delivery channel (URL query param). */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  token!: string;

  /** New password — same constraints as registration. */
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
