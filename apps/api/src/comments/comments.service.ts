import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { SocketEvents, WebhookEventTypes } from '@next-lane/shared';
import type { CommentDto } from '@next-lane/shared';

type CommentRow = {
  id: string;
  body: string;
  issueId: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    createdAt: Date;
  };
};

function toCommentDto(c: CommentRow): CommentDto {
  return {
    id: c.id,
    body: c.body,
    issueId: c.issueId,
    author: toUserDto(c.author),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async findAll(userId: string, issueId: string): Promise<CommentDto[]> {
    const issue = await this.getIssue(issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);
    const comments = await this.prisma.comment.findMany({
      where: { issueId },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(toCommentDto);
  }

  async create(
    userId: string,
    issueId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    const issue = await this.getIssue(issueId);
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);
    const comment = await this.prisma.comment.create({
      data: { issueId, authorId: userId, body: dto.body },
      include: { author: true },
    });
    const dtoOut = toCommentDto(comment);
    this.realtime.emitToProject(
      issue.projectId,
      SocketEvents.CommentCreated,
      dtoOut,
    );
    this.webhooks.dispatch(
      issue.projectId,
      WebhookEventTypes.CommentCreated,
      dtoOut,
    );

    // Fan out notifications: @mentions (MENTIONED) + watchers (COMMENTED), and
    // auto-watch the commenter + anyone mentioned. Resolution is co-member
    // scoped so mentions never cross tenants.
    const mentionedUserIds = await this.notifications.resolveMentions(
      userId,
      dto.body,
    );
    await this.notifications.notifyComment({
      authorId: userId,
      authorName: comment.author.name,
      issue: {
        id: issue.id,
        key: `${issue.projectKey}-${issue.number}`,
        projectId: issue.projectId,
      },
      mentionedUserIds,
    });
    return dtoOut;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCommentDto,
  ): Promise<CommentDto> {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('Not the author of this comment');
    }
    const comment = await this.prisma.comment.update({
      where: { id },
      data: { body: dto.body },
      include: { author: true },
    });
    return toCommentDto(comment);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.comment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('Not the author of this comment');
    }
    await this.prisma.comment.delete({ where: { id } });
    return { id };
  }

  private async getIssue(issueId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: {
        id: true,
        projectId: true,
        number: true,
        project: { select: { key: true } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return {
      id: issue.id,
      projectId: issue.projectId,
      number: issue.number,
      projectKey: issue.project.key,
    };
  }
}
