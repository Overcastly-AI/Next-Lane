import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { AuthResponse, MeDto, UserDto } from '@next-lane/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already registered');

    // The very first user ever created on a fresh install becomes the
    // instance admin — no separate bootstrap step required. Already-
    // provisioned installs are backfilled by the migration that added this
    // column instead (see schema.prisma's User.isInstanceAdmin doc comment).
    const isFirstUser = (await this.prisma.user.count()) === 0;

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        avatarColor: randomColor(),
        isInstanceAdmin: isFirstUser,
      },
    });
    return this.sign(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.sign(user);
  }

  private sign(user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    isInstanceAdmin: boolean;
    createdAt: Date;
  }): AuthResponse {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: toMeDto(user) };
  }

  /**
   * Issue the same JWT session shape as `login`/`register` for an already-
   * resolved user. Used by SSO/OIDC callback handling after JIT provisioning
   * so every login surface (password, OIDC) shares one token contract.
   */
  issueSession(user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    isInstanceAdmin: boolean;
    createdAt: Date;
  }): AuthResponse {
    return this.sign(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<MeDto> {
    const data: { name?: string; emailNotifications?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.emailNotifications !== undefined) data.emailNotifications = dto.emailNotifications;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return toMeDto(updated);
  }
}

/**
 * Maps a Prisma `User` row (or any subset carrying these core fields) to the
 * public `UserDto` shape used EVERYWHERE a user is embedded as a reference
 * (comment author, issue assignee/reporter, attachment uploader, etc.) —
 * deliberately does NOT include `isInstanceAdmin`, which is only meaningful
 * for "yourself" (see `toMeDto` below) and would otherwise force every
 * embedding call site across the app to select/supply that column.
 */
export function toUserDto(user: {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarColor: user.avatarColor,
    emailNotifications: user.emailNotifications,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Maps a Prisma `User` row to the fuller `MeDto` shape — `UserDto` plus
 * `isInstanceAdmin` — used only for the authenticated user's OWN profile
 * (login/register/`GET`+`PATCH /auth/me`/SSO session), never as an embedded
 * reference to someone else.
 */
export function toMeDto(user: {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  isInstanceAdmin: boolean;
  createdAt: Date;
}): MeDto {
  return {
    ...toUserDto(user),
    isInstanceAdmin: user.isInstanceAdmin,
  };
}

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];
export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}
