import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role, StatusCategory } from '@next-lane/shared';
import type {
  StandupEntryDto,
  StandupBlockerLinkDto,
  UserDto,
  IssueRefDto,
} from '@next-lane/shared';
import type { UpsertStandupDto } from './dto/standup.dto';

// ---------------------------------------------------------------------------
// Internal row types (shaped from Prisma includes)
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  emailNotifications: boolean;
  createdAt: Date;
}

/**
 * Issue row shape for blocker links.
 * Issue.key is derived: project.key + "-" + number. We include `project`
 * nested so we can reconstruct the key for the IssueRefDto.
 */
interface IssueRefRow {
  id: string;
  number: number;
  type: string;
  title: string;
  statusId: string;
  project: { key: string } | null;
}

interface BlockerLinkRow {
  id: string;
  standupEntryId: string;
  issueId: string;
  createdAt: Date;
  issue?: IssueRefRow | null;
}

interface StandupEntryRow {
  id: string;
  userId: string;
  teamId: string | null;
  projectId: string | null;
  date: Date;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: UserRow | null;
  blockerLinks?: BlockerLinkRow[];
}

/** Issue select fragment for blocker link includes. */
const ISSUE_REF_SELECT = {
  id: true,
  number: true,
  type: true,
  title: true,
  statusId: true,
  project: { select: { key: true } },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD using local wall-clock (server timezone). */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today as a YYYY-MM-DD local date string. */
function todayLocalString(): string {
  return toLocalDateString(new Date());
}

/**
 * Parse a YYYY-MM-DD string to midnight UTC DateTime for Prisma storage.
 * E.g. "2026-06-28" → new Date("2026-06-28T00:00:00.000Z")
 */
function parseDateToUtcMidnight(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) {
    throw new BadRequestException(
      `Invalid date "${dateStr}". Expected YYYY-MM-DD.`,
    );
  }
  return d;
}

function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarColor: u.avatarColor,
    emailNotifications: u.emailNotifications,
    createdAt: u.createdAt.toISOString(),
  };
}

function issueKey(row: IssueRefRow): string {
  return row.project ? `${row.project.key}-${row.number}` : `${row.number}`;
}

function toBlockerLinkDto(link: BlockerLinkRow): StandupBlockerLinkDto {
  const dto: StandupBlockerLinkDto = {
    id: link.id,
    standupEntryId: link.standupEntryId,
    issueId: link.issueId,
    createdAt: link.createdAt.toISOString(),
  };
  if (link.issue) {
    const issue = link.issue;
    const ref: IssueRefDto = {
      id: issue.id,
      key: issueKey(issue),
      type: issue.type as IssueRefDto['type'],
      title: issue.title,
      statusId: issue.statusId,
    };
    dto.issue = ref;
  }
  return dto;
}

export function toStandupEntryDto(row: StandupEntryRow): StandupEntryDto {
  const blockerLinks = (row.blockerLinks ?? []).map(toBlockerLinkDto);
  const blockerIssueIds = blockerLinks.map((l) => l.issueId);

  const dto: StandupEntryDto = {
    id: row.id,
    userId: row.userId,
    teamId: row.teamId,
    projectId: row.projectId,
    // Convert UTC midnight DateTime → YYYY-MM-DD local wall-clock string.
    date: toLocalDateString(row.date),
    yesterday: row.yesterday,
    today: row.today,
    blockers: row.blockers,
    blockerIssueIds,
    blockerLinks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.user) {
    dto.user = toUserDto(row.user);
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Blocker link include fragment (reused in multiple queries)
// ---------------------------------------------------------------------------

const BLOCKER_LINKS_INCLUDE = {
  include: {
    issue: {
      select: ISSUE_REF_SELECT,
    },
  },
  orderBy: { createdAt: 'asc' as const },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class StandupsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /projects/:projectId/standups?date=YYYY-MM-DD (VIEWER+)
   *
   * Returns all members' standup entries for the project on the given day,
   * ordered by user name. Includes the `user` and `blockerLinks` relations.
   */
  async findDigest(
    userId: string,
    projectId: string,
    dateStr?: string,
  ): Promise<StandupEntryDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);

    const day = parseDateToUtcMidnight(dateStr ?? todayLocalString());

    const rows = await this.prisma.standupEntry.findMany({
      where: {
        projectId,
        date: day,
      },
      include: {
        user: true,
        blockerLinks: BLOCKER_LINKS_INCLUDE,
      },
      orderBy: { user: { name: 'asc' } },
    });

    return rows.map((r) => toStandupEntryDto(r as unknown as StandupEntryRow));
  }

  /**
   * GET /projects/:projectId/standups/me?date=YYYY-MM-DD (VIEWER+)
   *
   * Returns the caller's entry for the given day, or null if none exists.
   */
  async findMyEntry(
    userId: string,
    projectId: string,
    dateStr?: string,
  ): Promise<StandupEntryDto | null> {
    await assertProjectMember(this.prisma, userId, projectId);

    const day = parseDateToUtcMidnight(dateStr ?? todayLocalString());

    // findFirst with explicit null filter rather than findUnique, because the
    // Prisma-generated compound unique input type for nullable columns requires
    // non-null strings (a known Prisma limitation with NULLS NOT DISTINCT).
    const row = await this.prisma.standupEntry.findFirst({
      where: {
        userId,
        teamId: null,
        projectId,
        date: day,
      },
      include: {
        user: true,
        blockerLinks: BLOCKER_LINKS_INCLUDE,
      },
    });

    return row ? toStandupEntryDto(row as unknown as StandupEntryRow) : null;
  }

  /**
   * POST /projects/:projectId/standups (MEMBER+)
   *
   * Upsert the caller's standup entry for (userId, projectId, date).
   * Blocker links are replaced atomically: all old links are deleted and the
   * new ones are created within a single transaction.
   *
   * blockerIssueIds must all belong to the project; unknown IDs are rejected
   * with a 400.
   */
  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertStandupDto,
  ): Promise<StandupEntryDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const dateStr = dto.date ?? todayLocalString();
    const day = parseDateToUtcMidnight(dateStr);

    const blockerIssueIds = dto.blockerIssueIds ?? [];

    // Validate blocker issue IDs belong to the project.
    if (blockerIssueIds.length > 0) {
      const found = await this.prisma.issue.findMany({
        where: { id: { in: blockerIssueIds }, projectId },
        select: { id: true },
      });
      if (found.length !== blockerIssueIds.length) {
        const foundIds = new Set(found.map((f) => f.id));
        const missing = blockerIssueIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(
          `Issue IDs not found in project: ${missing.join(', ')}`,
        );
      }
    }

    // Use an interactive transaction so the upsert + link replacement is atomic.
    const entry = await this.prisma.$transaction(async (tx) => {
      // Manual upsert: Prisma cannot target a compound unique that includes a
      // nullable column (teamId IS NULL) via upsert/where — passing null there
      // throws at runtime. So find-then-update/create instead. The DB-level
      // unique with NULLS NOT DISTINCT still guards against duplicates.
      const existing = await tx.standupEntry.findFirst({
        where: { userId, teamId: null, projectId, date: day },
        select: { id: true },
      });

      const upserted = existing
        ? await tx.standupEntry.update({
            where: { id: existing.id },
            data: {
              yesterday: dto.yesterday,
              today: dto.today,
              blockers: dto.blockers,
            },
          })
        : await tx.standupEntry.create({
            data: {
              userId,
              projectId,
              teamId: null,
              date: day,
              yesterday: dto.yesterday,
              today: dto.today,
              blockers: dto.blockers,
            },
          });

      // Replace blocker links: delete all existing, then create the new set.
      await tx.standupBlockerLink.deleteMany({
        where: { standupEntryId: upserted.id },
      });

      if (blockerIssueIds.length > 0) {
        await tx.standupBlockerLink.createMany({
          data: blockerIssueIds.map((issueId) => ({
            standupEntryId: upserted.id,
            issueId,
          })),
        });
      }

      // Re-fetch with links included so the returned DTO is complete.
      const withLinks = await tx.standupEntry.findUniqueOrThrow({
        where: { id: upserted.id },
        include: {
          user: true,
          blockerLinks: BLOCKER_LINKS_INCLUDE,
        },
      });

      return withLinks;
    });

    return toStandupEntryDto(entry as unknown as StandupEntryRow);
  }

  /**
   * GET /projects/:projectId/standups/prefill (VIEWER+)
   *
   * Suggests `yesterday` text from the caller's recent ActivityLog changes
   * (last ~24 hours) and `today` text from their currently-assigned in-progress
   * issues. Does not persist anything — for UI form seeding only.
   */
  async prefill(
    userId: string,
    projectId: string,
  ): Promise<{ yesterday: string; today: string }> {
    await assertProjectMember(this.prisma, userId, projectId);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // --- Yesterday: recent activity on issues in this project ---
    const recentActivity = await this.prisma.activityLog.findMany({
      where: {
        actorId: userId,
        createdAt: { gte: since },
        issue: { projectId },
      },
      include: {
        issue: {
          select: {
            id: true,
            number: true,
            title: true,
            project: { select: { key: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Group activity by issue, collecting distinct change descriptions.
    const issueChanges = new Map<
      string,
      { key: string; title: string; changes: Set<string> }
    >();

    for (const act of recentActivity) {
      const issue = act.issue;
      if (!issue) continue;
      const issueId = act.issueId;
      const key = issue.project
        ? `${issue.project.key}-${issue.number}`
        : `${issue.number}`;
      if (!issueChanges.has(issueId)) {
        issueChanges.set(issueId, { key, title: issue.title, changes: new Set() });
      }
      const entry = issueChanges.get(issueId)!;
      if (act.field === 'status' && act.to) {
        entry.changes.add(`moved to ${act.to}`);
      } else if (act.field === 'created') {
        entry.changes.add('created');
      } else if (act.field === 'assignee') {
        entry.changes.add('updated assignee');
      } else if (act.field) {
        entry.changes.add(`updated ${act.field}`);
      }
    }

    const yesterdayLines: string[] = [];
    for (const { key, title, changes } of issueChanges.values()) {
      const changesStr = Array.from(changes).join(', ');
      yesterdayLines.push(
        changesStr ? `${key} ${title} (${changesStr})` : `${key} ${title}`,
      );
    }

    // --- Today: currently-assigned in-progress issues ---
    const inProgressStatuses = await this.prisma.status.findMany({
      where: { projectId, category: StatusCategory.IN_PROGRESS },
      select: { id: true },
    });
    const inProgressIds = inProgressStatuses.map((s) => s.id);

    const todayLines: string[] = [];
    if (inProgressIds.length > 0) {
      const assignedIssues = await this.prisma.issue.findMany({
        where: {
          projectId,
          assigneeId: userId,
          statusId: { in: inProgressIds },
        },
        select: {
          number: true,
          title: true,
          project: { select: { key: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      });
      for (const issue of assignedIssues) {
        const key = issue.project
          ? `${issue.project.key}-${issue.number}`
          : `${issue.number}`;
        todayLines.push(`${key} ${issue.title}`);
      }
    }

    return {
      yesterday:
        yesterdayLines.length > 0
          ? yesterdayLines.join('\n')
          : 'No recent activity found.',
      today:
        todayLines.length > 0
          ? todayLines.join('\n')
          : 'No in-progress issues assigned.',
    };
  }
}
