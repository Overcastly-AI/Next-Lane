import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Notification, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MailService } from '../mail/mail.service';
import { toUserDto } from '../auth/auth.service';
import {
  NotificationType,
  SocketEvents,
} from '@next-lane/shared';
import type {
  NotificationDto,
  NotificationListDto,
  UnreadCountDto,
} from '@next-lane/shared';

/** Fields that are considered meaningful changes for watcher notifications. */
export const WATCHED_FIELDS = [
  'status',
  'assignee',
  'priority',
  'title',
  'startDate',
  'dueDate',
] as const;

/** Cap on how many notifications a single list request returns. */
const LIST_LIMIT = 50;

type NotificationRow = Notification & { actor: User | null };

function toNotificationDto(n: NotificationRow): NotificationDto {
  return {
    id: n.id,
    type: n.type as NotificationType,
    actor: n.actor ? toUserDto(n.actor) : null,
    issueId: n.issueId,
    issueKey: n.issueKey,
    projectId: n.projectId,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Snapshot of the source issue needed to render a notification. */
export interface IssueSnapshot {
  id: string;
  key: string;
  projectId: string;
}

/** Base URL for issue deep-links in notification emails. */
function issueDeepLinkBase(): string {
  return (
    process.env.WEB_BASE_URL ??
    process.env.RESET_BASE_URL ??
    'http://localhost:3000'
  );
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
  ) {}

  // ---- Public API (caller-scoped) ----------------------------------------

  async list(userId: string): Promise<NotificationListDto> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return { items: rows.map(toNotificationDto), unreadCount };
  }

  async unreadCount(userId: string): Promise<UnreadCountDto> {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  /** Mark one notification read. Owner-scoped: only the recipient may do it. */
  async markRead(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.userId !== userId) {
      throw new ForbiddenException('Not your notification');
    }
    await this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return { id };
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { count: res.count };
  }

  // ---- Internal creation (called by other domain services) ---------------

  /**
   * Persist a notification and push it to the recipient's live feed. Never
   * notifies the actor about their own action (a self-notification is dropped).
   * Returns the created DTO, or null if it was skipped.
   */
  async notify(params: {
    userId: string;
    actorId: string;
    type: NotificationType;
    issue: IssueSnapshot;
    message: string;
    emailSubject?: string;
    emailBodyLine?: string;
  }): Promise<NotificationDto | null> {
    if (params.userId === params.actorId) return null;

    const created = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        actorId: params.actorId,
        type: params.type,
        issueId: params.issue.id,
        issueKey: params.issue.key,
        projectId: params.issue.projectId,
        message: params.message,
      },
      include: { actor: true },
    });
    const dto = toNotificationDto(created);
    this.realtime.emitToUser(
      params.userId,
      SocketEvents.NotificationCreated,
      dto,
    );

    // Fire-and-forget email to opted-in recipients (after DB/realtime work).
    if (params.emailSubject && params.emailBodyLine) {
      void this.sendEmailToRecipients(
        [params.userId],
        params.emailSubject,
        params.issue,
        params.emailBodyLine,
      );
    }

    return dto;
  }

  /** Idempotently add a user as a watcher of an issue. */
  async addWatcher(issueId: string, userId: string): Promise<void> {
    await this.prisma.watcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
  }

  /**
   * Fan out an assignment notification: notify the new assignee (unless they
   * assigned themselves) and auto-watch them so they get follow-up activity.
   */
  async notifyAssigned(params: {
    assigneeId: string;
    actorId: string;
    issue: IssueSnapshot;
    actorName: string;
  }): Promise<void> {
    await this.addWatcher(params.issue.id, params.assigneeId);
    await this.notify({
      userId: params.assigneeId,
      actorId: params.actorId,
      type: NotificationType.ASSIGNED,
      issue: params.issue,
      message: `${params.actorName} assigned ${params.issue.key} to you`,
      emailSubject: `[${params.issue.key}] Assigned to you`,
      emailBodyLine: `${params.actorName} assigned ${params.issue.key} to you.`,
    });
  }

  /**
   * Fan out a comment: notify every watcher except the author (COMMENTED), and
   * notify each mentioned co-member (MENTIONED). Mentioned users and the
   * commenter are auto-watched. A user mentioned AND watching gets a single
   * MENTIONED notification (mentions take precedence).
   *
   * DB writes are batched: one `createMany` for MENTIONED rows, one `createMany`
   * for COMMENTED rows — two round-trips regardless of how many watchers or
   * mentions exist. Realtime pushes are per-recipient (socket emit is cheap).
   */
  async notifyComment(params: {
    authorId: string;
    authorName: string;
    issue: IssueSnapshot;
    mentionedUserIds: string[];
  }): Promise<void> {
    // The commenter now watches the issue.
    await this.addWatcher(params.issue.id, params.authorId);

    const mentioned = new Set(params.mentionedUserIds);

    // Auto-watch all mentioned users in parallel (upserts are idempotent).
    if (mentioned.size > 0) {
      await Promise.all(
        [...mentioned].map((uid) => this.addWatcher(params.issue.id, uid)),
      );
    }

    // Fetch current watchers AFTER the author + mention watches are recorded so
    // the watcher list is complete before we decide who gets which notification.
    const watchers = await this.prisma.watcher.findMany({
      where: { issueId: params.issue.id },
      select: { userId: true },
    });

    // Partition recipients: mentioned users get MENTIONED (higher precedence),
    // plain watchers (not the author and not already mentioned) get COMMENTED.
    const mentionMessage = `${params.authorName} mentioned you on ${params.issue.key}`;
    const commentMessage = `${params.authorName} commented on ${params.issue.key}`;

    // Exclude the author from both notification types (suppress self-notification).
    const mentionedRecipients = [...mentioned].filter(
      (uid) => uid !== params.authorId,
    );
    const commentedRecipients = watchers
      .map((w) => w.userId)
      .filter((uid) => uid !== params.authorId && !mentioned.has(uid));

    // Batch insert MENTIONED notifications (one round-trip).
    if (mentionedRecipients.length > 0) {
      await this.prisma.notification.createMany({
        data: mentionedRecipients.map((userId) => ({
          userId,
          actorId: params.authorId,
          type: NotificationType.MENTIONED,
          issueId: params.issue.id,
          issueKey: params.issue.key,
          projectId: params.issue.projectId,
          message: mentionMessage,
        })),
        skipDuplicates: true,
      });

      // Fetch inserted rows to get generated ids for realtime emit.
      const mentionedRows = await this.prisma.notification.findMany({
        where: {
          issueId: params.issue.id,
          actorId: params.authorId,
          type: NotificationType.MENTIONED,
          userId: { in: mentionedRecipients },
          message: mentionMessage,
        },
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        take: mentionedRecipients.length,
      });
      for (const n of mentionedRows) {
        this.realtime.emitToUser(
          n.userId,
          SocketEvents.NotificationCreated,
          toNotificationDto(n),
        );
      }
    }

    // Batch insert COMMENTED notifications (one round-trip).
    if (commentedRecipients.length > 0) {
      await this.prisma.notification.createMany({
        data: commentedRecipients.map((userId) => ({
          userId,
          actorId: params.authorId,
          type: NotificationType.COMMENTED,
          issueId: params.issue.id,
          issueKey: params.issue.key,
          projectId: params.issue.projectId,
          message: commentMessage,
        })),
        skipDuplicates: true,
      });

      // Fetch inserted rows to get generated ids for realtime emit.
      const commentedRows = await this.prisma.notification.findMany({
        where: {
          issueId: params.issue.id,
          actorId: params.authorId,
          type: NotificationType.COMMENTED,
          userId: { in: commentedRecipients },
          message: commentMessage,
        },
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        take: commentedRecipients.length,
      });
      for (const n of commentedRows) {
        this.realtime.emitToUser(
          n.userId,
          SocketEvents.NotificationCreated,
          toNotificationDto(n),
        );
      }
    }

    // Fire-and-forget emails after all DB/realtime work (no await — never blocks).
    void this.sendEmailToRecipients(
      mentionedRecipients,
      `[${params.issue.key}] You were mentioned`,
      params.issue,
      `${params.authorName} mentioned you on ${params.issue.key}.`,
    );
    void this.sendEmailToRecipients(
      commentedRecipients,
      `[${params.issue.key}] New comment`,
      params.issue,
      `${params.authorName} commented on ${params.issue.key}.`,
    );
  }

  /**
   * Fan out a WATCHED_UPDATED notification to every watcher of an issue when a
   * meaningful field changes (status, assignee, priority, title, dueDate).
   *
   * Uses a single `createMany` to batch all inserts rather than N sequential
   * `create` calls. Each watcher then gets a realtime push via their private
   * `user:<id>` room. The actor is excluded (never notify yourself).
   *
   * @param params.actorId      - User who made the change.
   * @param params.actorName    - Display name of the actor.
   * @param params.issue        - Snapshot of the updated issue.
   * @param params.changedFields - Which meaningful fields changed (used in message).
   */
  async notifyWatchersUpdated(params: {
    actorId: string;
    actorName: string;
    issue: IssueSnapshot & { title: string };
    changedFields: string[];
  }): Promise<void> {
    const watchers = await this.prisma.watcher.findMany({
      where: { issueId: params.issue.id },
      select: { userId: true },
    });

    // Exclude the actor themselves.
    const recipients = watchers
      .map((w) => w.userId)
      .filter((uid) => uid !== params.actorId);

    if (recipients.length === 0) return;

    const fieldLabel =
      params.changedFields.length === 1
        ? params.changedFields[0]
        : params.changedFields.slice(0, -1).join(', ') +
          ' and ' +
          params.changedFields[params.changedFields.length - 1];

    const message = `${params.actorName} updated ${params.issue.key} (${fieldLabel})`;

    // Batch insert — one round-trip regardless of watcher count.
    await this.prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        actorId: params.actorId,
        type: NotificationType.WATCHED_UPDATED,
        issueId: params.issue.id,
        issueKey: params.issue.key,
        projectId: params.issue.projectId,
        message,
      })),
      skipDuplicates: true,
    });

    // Push realtime events to each recipient's private room. Fetch the created
    // notifications to get their generated ids and createdAt timestamps.
    const created = await this.prisma.notification.findMany({
      where: {
        issueId: params.issue.id,
        actorId: params.actorId,
        type: NotificationType.WATCHED_UPDATED,
        userId: { in: recipients },
        message,
      },
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      take: recipients.length,
    });

    for (const n of created) {
      this.realtime.emitToUser(
        n.userId,
        SocketEvents.NotificationCreated,
        toNotificationDto(n),
      );
    }

    // Fire-and-forget emails after all DB/realtime work.
    void this.sendEmailToRecipients(
      recipients,
      `[${params.issue.key}] Updated`,
      params.issue,
      `${params.actorName} updated ${params.issue.key} (${fieldLabel}).`,
    );
  }

  // ---- Email delivery (opt-in) -------------------------------------------

  /**
   * Fetch opted-in recipients and send a notification email to each of them.
   *
   * Sends are fire-and-forget (Promise.all after all DB/realtime work) and
   * never throw — MailService.send() already swallows delivery errors.
   *
   * @param recipientIds  IDs of users who may receive an email (actor already
   *                      excluded upstream; we further filter by opt-in flag).
   * @param subject       Email subject line, e.g. "[NL-12] Assigned to you".
   * @param issue         Snapshot of the issue for deep-link generation.
   * @param bodyLine      Single sentence describing the event.
   */
  private async sendEmailToRecipients(
    recipientIds: string[],
    subject: string,
    issue: IssueSnapshot,
    bodyLine: string,
  ): Promise<void> {
    if (recipientIds.length === 0) return;

    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, email: true, emailNotifications: true },
      });

      const optedIn = users.filter((u) => u.emailNotifications);
      if (optedIn.length === 0) return;

      const base = issueDeepLinkBase();
      const url = `${base}/projects/${issue.projectId}/board?issue=${issue.id}`;

      const text = `${bodyLine}\n\nView in Next Lane: ${url}`;
      const html =
        `<p>${bodyLine}</p>` +
        `<p><a href="${url}">View in Next Lane</a></p>`;

      // Individual send errors are swallowed — a failed delivery must never
      // break the in-app notification flow. MailService.send() already logs;
      // we also catch at the outer level so no unexpected throw becomes an
      // unhandled Promise rejection when this method is called fire-and-forget.
      await Promise.all(
        optedIn.map((u) =>
          this.mail
            .send({ to: u.email, subject, text, html })
            .catch(() => undefined),
        ),
      );
    } catch {
      // Swallow any unexpected error (e.g. DB blip) — email delivery is best-
      // effort and must never surface as an unhandled rejection.
    }
  }

  /**
   * Parse @mentions from a comment body and resolve them to co-member user ids.
   *
   * Mention syntax: `@<email>` (e.g. `@alice@acme.dev`). Email is the most
   * unambiguous token to match and is already unique per user. We resolve each
   * matched email to a user who shares at least one workspace with the author
   * (co-member), so mentions can never leak across tenants. Returns the set of
   * resolved recipient user ids (excluding the author).
   */
  async resolveMentions(
    authorId: string,
    body: string,
  ): Promise<string[]> {
    // @ followed by an email-shaped token. Stops at whitespace.
    const emailRe = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    const emails = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = emailRe.exec(body)) !== null) {
      emails.add(m[1].toLowerCase());
    }
    if (emails.size === 0) return [];

    // Workspaces the author belongs to.
    const authorMemberships = await this.prisma.membership.findMany({
      where: { userId: authorId },
      select: { workspaceId: true },
    });
    const workspaceIds = authorMemberships.map((mm) => mm.workspaceId);
    if (workspaceIds.length === 0) return [];

    // Resolve emails to users who co-member at least one of those workspaces.
    const users = await this.prisma.user.findMany({
      where: {
        email: { in: Array.from(emails) },
        memberships: { some: { workspaceId: { in: workspaceIds } } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id).filter((id) => id !== authorId);
  }
}
