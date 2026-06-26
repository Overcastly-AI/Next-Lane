import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toUserDto } from '../auth/auth.service';
import type { UserDto } from '@next-lane/shared';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return only users who share at least one workspace with the caller
   * (the caller is always included). This endpoint powers the assignee picker,
   * which only needs co-members — returning all users platform-wide would leak
   * every tenant's names and emails to any authenticated user.
   */
  async findAll(callerId: string): Promise<UserDto[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: callerId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: callerId },
          { memberships: { some: { workspaceId: { in: workspaceIds } } } },
        ],
      },
      orderBy: { name: 'asc' },
    });
    return users.map(toUserDto);
  }

  async findOne(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return toUserDto(user);
  }
}
