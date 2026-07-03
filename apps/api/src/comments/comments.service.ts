import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  assertProjectMember,
  assertProjectRole,
  getEffectiveProjectRole,
} from '../common/membership.util';
import { withIdempotency } from '../common/idempotency.util';
import { AutomationTrigger, Role, SocketEvents, WebhookEventTypes } from '@next-lane/shared';
import { toUserDto } from '../auth/auth.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import type { CommentDto } from '@next-lane/shared';
import { AUTOMATION_EVENTS } from '../automations/automation-events';

/** Options for automation-aware mutations. */
export interface CommentMutationOpts {
  /** When true, the event emitted will carry `automated: true` (loop guard). */
  automated?: boolean;
}

type CommentRow = {
  id: string;
  body: string;
  issueId: string;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // author is null when the user has been deleted (onDelete: SetNull)
  author: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    createdAt: Date;
  } | null;
};

/** Sentinel UserDto used when a comment author has been deleted. */
const DELETED_USER_DTO = {
  id: '',
  email: '',
  name: 'Deleted User',
  avatarColor: '#94a3b8',
  emailNotifications: false,
  createdAt: new Date(0).toISOString(),
};

function toCommentDto(c: CommentRow): CommentDto {
  return {
    id: c.id,
    body: c.body,
    issueId: c.issueId,
    author: c.author ? toUserDto(c.author) : DELETED_USER_DTO,
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
    private readonly eventEmitter: EventEmitter2,
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

  /**
   * Add a comment to an issue. When `dto.idempotencyKey` is set, retrying
   * this call with the SAME key (scoped to this user) within the idempotency
   * window replays the original created comment instead of posting a
   * duplicate — see {@link withIdempotency} (Agent Experience Round 2,
   * criterion 2).
   */
  async create(
    userId: string,
    issueId: string,
    dto: CreateCommentDto,
    opts?: CommentMutationOpts,
  ): Promise<CommentDto> {
    return withIdempotency(
      this.prisma,
      { userId, endpoint: 'POST comments', key: dto.idempotencyKey },
      () => this.createInner(userId, issueId, dto, opts),
    );
  }

  private async createInner(
    userId: string,
    issueId: string,
    dto: CreateCommentDto,
    opts?: CommentMutationOpts,
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
      authorName: comment.author?.name ?? 'Someone',
      issue: {
        id: issue.id,
        key: `${issue.projectKey}-${issue.number}`,
        projectId: issue.projectId,
      },
      mentionedUserIds,
    });

    // Emit automation event AFTER the mutation + dispatch are done.
    this.eventEmitter.emit(AUTOMATION_EVENTS.ISSUE_COMMENTED, {
      projectId: issue.projectId,
      issueId: issue.id,
      actorUserId: userId,
      trigger: AutomationTrigger.ISSUE_COMMENTED,
      automated: opts?.automated ?? false,
    });

    return dtoOut;
  }

  /**
   * Update a comment's body. Gated author-or-effective-project-ADMIN — the
   * same rule work logs use (`WorkLogsService.update`) — rather than
   * author-only: a project admin needs to be able to fix/redact a comment
   * even when the original author has left. `getEffectiveProjectRole` means
   * a per-project role override (when present) governs this the same as
   * every other project-scoped write.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateCommentDto,
  ): Promise<CommentDto> {
    const existing = await this.getCommentWithProject(id);
    await this.assertAuthorOrProjectAdmin(userId, existing);

    const comment = await this.prisma.comment.update({
      where: { id },
      data: { body: dto.body },
      include: { author: true },
    });
    return toCommentDto(comment);
  }

  /**
   * Delete a comment. Same author-or-effective-project-ADMIN gate as
   * {@link update} (mirrors `WorkLogsService.remove`).
   */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.getCommentWithProject(id);
    await this.assertAuthorOrProjectAdmin(userId, existing);

    await this.prisma.comment.delete({ where: { id } });
    return { id };
  }

  /** Load a comment (with its issue's projectId) and throw 404 if not found. */
  private async getCommentWithProject(
    id: string,
  ): Promise<{ id: string; authorId: string | null; projectId: string }> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: { id: true, authorId: true, issue: { select: { projectId: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    return { id: comment.id, authorId: comment.authorId, projectId: comment.issue.projectId };
  }

  /**
   * Reject unless `userId` is either the comment's author or has EFFECTIVE
   * project ADMIN. Requires at least project membership (VIEWER+) — a
   * non-member (of any role) is rejected with the same message a missing
   * project would give, so foreign-tenant probing doesn't distinguish
   * "exists, not a member" from "not found".
   */
  private async assertAuthorOrProjectAdmin(
    userId: string,
    comment: { authorId: string | null; projectId: string },
  ): Promise<void> {
    const project = await assertProjectMember(this.prisma, userId, comment.projectId);
    const effective = await getEffectiveProjectRole(
      this.prisma,
      userId,
      project.workspaceId,
      comment.projectId,
    );
    const isAuthor = comment.authorId === userId;
    const isAdmin = effective?.role === Role.ADMIN;
    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the author or a project admin can modify this comment',
      );
    }
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
