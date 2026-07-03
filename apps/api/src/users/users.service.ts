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
   *
   * Optional `q` (MCP-QA pass-1 finding 6 / Agent Experience Round 2
   * fold-in): server-side, case-insensitive substring match against name OR
   * email, applied on top of the same co-member scope — an agent resolving
   * "who is Dana" no longer has to page through every workspace member.
   */
  async findAll(callerId: string, q?: string): Promise<UserDto[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: callerId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const trimmedQ = q?.trim();

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { id: callerId },
              { memberships: { some: { workspaceId: { in: workspaceIds } } } },
            ],
          },
          ...(trimmedQ
            ? [
                {
                  OR: [
                    { name: { contains: trimmedQ, mode: 'insensitive' as const } },
                    { email: { contains: trimmedQ, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: { name: 'asc' },
    });
    return users.map(toUserDto);
  }

  /**
   * Fetch a single user by id, but only if they share at least one workspace
   * with the caller (the caller may always fetch themselves). This applies the
   * same co-member scoping as `findAll`: without it, any authenticated user
   * could fetch any other user's name/email/avatar across tenants by id. A
   * non-co-member is indistinguishable from a non-existent user — both 404 — so
   * we don't leak the existence of foreign accounts.
   */
  async findOne(callerId: string, id: string): Promise<UserDto> {
    if (id === callerId) {
      const self = await this.prisma.user.findUnique({ where: { id } });
      if (!self) throw new NotFoundException('User not found');
      return toUserDto(self);
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: callerId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        memberships: { some: { workspaceId: { in: workspaceIds } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return toUserDto(user);
  }
}
