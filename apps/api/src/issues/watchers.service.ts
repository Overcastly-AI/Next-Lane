import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectMember } from '../common/membership.util';

export interface WatchToggleResult {
  watching: boolean;
}

export interface WatcherInfoResult {
  count: number;
  isWatching: boolean;
}

/**
 * Manages manual watch subscriptions on issues. The auto-watch behavior
 * (assignee and commenter auto-subscribe) lives in NotificationsService; this
 * service only handles the explicit POST/DELETE toggle and the info query.
 *
 * Authorization: any project member (VIEWER or higher) may watch/unwatch any
 * issue in their project. Both toggle operations are idempotent.
 */
@Injectable()
export class WatchersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the issue and assert the caller is a project member.
   * Throws NotFoundException if the issue does not exist, ForbiddenException if
   * the caller is not a project member.
   */
  private async resolveAndAuthorize(
    issueId: string,
    userId: string,
  ): Promise<string> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    await assertProjectMember(this.prisma, userId, issue.projectId);
    return issue.projectId;
  }

  /**
   * Upsert a Watcher row for the caller. Idempotent: calling this when the
   * caller already watches the issue does not error.
   */
  async watch(issueId: string, userId: string): Promise<WatchToggleResult> {
    await this.resolveAndAuthorize(issueId, userId);
    await this.prisma.watcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: {},
    });
    return { watching: true };
  }

  /**
   * Delete the caller's Watcher row. Idempotent: calling this when the caller
   * is not watching the issue does not error.
   */
  async unwatch(issueId: string, userId: string): Promise<WatchToggleResult> {
    await this.resolveAndAuthorize(issueId, userId);
    // deleteMany is idempotent (no error when the row does not exist).
    await this.prisma.watcher.deleteMany({
      where: { issueId, userId },
    });
    return { watching: false };
  }

  /**
   * Return the total watcher count for an issue and whether the caller is
   * currently watching it. Both values are fetched in a single query via
   * Prisma aggregate + conditional include so the caller never needs two
   * round-trips.
   */
  async getWatcherInfo(
    issueId: string,
    userId: string,
  ): Promise<WatcherInfoResult> {
    await this.resolveAndAuthorize(issueId, userId);
    const [count, callerRow] = await Promise.all([
      this.prisma.watcher.count({ where: { issueId } }),
      this.prisma.watcher.findUnique({
        where: { issueId_userId: { issueId, userId } },
        select: { userId: true },
      }),
    ]);
    return { count, isWatching: callerRow !== null };
  }
}
