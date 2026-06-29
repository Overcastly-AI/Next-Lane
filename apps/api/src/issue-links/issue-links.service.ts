import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IssueLinkType,
  ISSUE_LINK_INVERSE,
  ISSUE_LINK_TYPE_LABELS,
  Role,
} from '@next-lane/shared';
import type { IssueLinkDto, IssueRefDto, StatusDto } from '@next-lane/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateIssueLinkDto } from './dto/create-issue-link.dto';

// ── types ────────────────────────────────────────────────────────────────────

/**
 * Prisma-selected shape of an Issue sufficient to build an IssueRefDto.
 * Mirrors the `refSelect` fields used in issues.service findOne.
 */
interface IssueLinkIssueRef {
  id: string;
  number: number;
  type: string;
  title: string;
  statusId: string;
  project: { key: string } | null;
  status: {
    id: string;
    name: string;
    category: string;
    order: number;
    projectId: string;
  } | null;
}

/** Prisma IssueLink row with source + target expanded. */
interface IssueLinkWithRefs {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  createdAt: Date;
  source: IssueLinkIssueRef;
  target: IssueLinkIssueRef;
}

// ── canonical-type helpers ────────────────────────────────────────────────────

/**
 * The set of types stored with source == the "actor" issue (non-inverse).
 * RELATES_TO is symmetric so it is always stored with source = :id.
 */
const CANONICAL_TYPES = new Set<IssueLinkType>([
  IssueLinkType.BLOCKS,
  IssueLinkType.DUPLICATES,
  IssueLinkType.CLONES,
  IssueLinkType.RELATES_TO,
]);

/**
 * Maps an inverse type to its canonical counterpart (and signals that the
 * source/target must be swapped before storing).
 */
const INVERSE_TO_CANONICAL: Partial<Record<IssueLinkType, IssueLinkType>> = {
  [IssueLinkType.BLOCKED_BY]: IssueLinkType.BLOCKS,
  [IssueLinkType.DUPLICATED_BY]: IssueLinkType.DUPLICATES,
};

// ── mapper ────────────────────────────────────────────────────────────────────

function toStatusDto(s: {
  id: string;
  name: string;
  category: string;
  order: number;
  wipLimit?: number | null;
  projectId: string;
}): StatusDto {
  return {
    id: s.id,
    name: s.name,
    category: s.category as StatusDto['category'],
    order: s.order,
    wipLimit: s.wipLimit ?? null,
    projectId: s.projectId,
  };
}

function toIssueRefDto(issue: IssueLinkIssueRef): IssueRefDto {
  const key = issue.project
    ? `${issue.project.key}-${issue.number}`
    : `${issue.number}`;
  const ref: IssueRefDto = {
    id: issue.id,
    key,
    type: issue.type as IssueRefDto['type'],
    title: issue.title,
    statusId: issue.statusId,
  };
  if (issue.status) ref.status = toStatusDto(issue.status);
  return ref;
}

/**
 * Build an IssueLinkDto from the perspective of `viewerIssueId`.
 *
 * When `viewerIssueId` is the source, the stored type is returned as-is and
 * the target is the related issue.
 * When `viewerIssueId` is the target, the type is inverted (BLOCKS → BLOCKED_BY
 * etc.) and the source becomes the related issue.
 */
export function toIssueLinkDto(
  link: IssueLinkWithRefs,
  viewerIssueId: string,
): IssueLinkDto {
  const storedType = link.type as IssueLinkType;
  let resolvedType: IssueLinkType;
  let relatedIssue: IssueRefDto;

  if (link.sourceId === viewerIssueId) {
    resolvedType = storedType;
    relatedIssue = toIssueRefDto(link.target);
  } else {
    // viewer is the target — invert
    resolvedType = ISSUE_LINK_INVERSE[storedType];
    relatedIssue = toIssueRefDto(link.source);
  }

  return {
    id: link.id,
    type: resolvedType,
    label: ISSUE_LINK_TYPE_LABELS[resolvedType],
    relatedIssue,
    createdAt: link.createdAt.toISOString(),
  };
}

// ── prisma include for link rows ──────────────────────────────────────────────

const refInclude = {
  id: true,
  number: true,
  type: true,
  title: true,
  statusId: true,
  project: { select: { key: true } },
  status: true,
} as const;

const linkInclude = {
  source: { select: refInclude },
  target: { select: refInclude },
} as const;

// ── service ───────────────────────────────────────────────────────────────────

@Injectable()
export class IssueLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the target string to an Issue row. Accepts either a human-readable
   * issue key (e.g. "NL-5") or a CUID id.
   *
   * The key is parsed by splitting on the LAST hyphen — the trailing segment is
   * the issue number and everything before it is the project key. Project keys
   * are only constrained to be 1–10 chars, so they may themselves contain
   * hyphens/digits/underscores (e.g. "NEXT-LANE-5"); a stricter pattern would
   * wrongly reject those. The project key is resolved within the SOURCE issue's
   * workspace (keys are unique per workspace, not globally).
   */
  private async resolveTarget(
    target: string,
    sourceProject: { id: string; key: string; workspaceId: string },
  ): Promise<{ id: string; projectId: string }> {
    const trimmed = target.trim();

    const lastDash = trimmed.lastIndexOf('-');
    const numPart = lastDash > 0 ? trimmed.slice(lastDash + 1) : '';
    if (lastDash > 0 && /^\d+$/.test(numPart)) {
      const projectKey = trimmed.slice(0, lastDash).toUpperCase();
      const number = parseInt(numPart, 10);

      // Prefer the source project when the key matches it; otherwise look it up
      // within the same workspace.
      const targetProjectId =
        projectKey === sourceProject.key.toUpperCase()
          ? sourceProject.id
          : (
              await this.prisma.project.findFirst({
                where: { workspaceId: sourceProject.workspaceId, key: projectKey },
                select: { id: true },
              })
            )?.id;

      if (targetProjectId) {
        const issue = await this.prisma.issue.findUnique({
          where: { projectId_number: { projectId: targetProjectId, number } },
          select: { id: true, projectId: true },
        });
        if (issue) return issue;
      }
      // A CUID id never matches the "<key>-<digits>" shape (cuids have no
      // hyphens), so a parsed-but-unresolved key is a genuine not-found.
      throw new NotFoundException(`Issue "${target}" not found`);
    }

    // Fallback: treat as a CUID id.
    const issue = await this.prisma.issue.findUnique({
      where: { id: trimmed },
      select: { id: true, projectId: true },
    });
    if (!issue) {
      throw new NotFoundException(`Issue "${target}" not found`);
    }
    return issue;
  }

  async create(
    userId: string,
    sourceIssueId: string,
    dto: CreateIssueLinkDto,
  ): Promise<IssueLinkDto> {
    // Load the source issue with the project key + workspace needed to resolve a
    // target issue key.
    const sourceIssue = await this.prisma.issue.findUnique({
      where: { id: sourceIssueId },
      select: {
        id: true,
        projectId: true,
        project: { select: { id: true, key: true, workspaceId: true } },
      },
    });
    if (!sourceIssue || !sourceIssue.project) {
      throw new NotFoundException('Issue not found');
    }

    // Caller must be MEMBER+ on the project.
    await assertProjectRole(
      this.prisma,
      userId,
      sourceIssue.projectId,
      Role.MEMBER,
    );

    // Resolve the target.
    const targetIssue = await this.resolveTarget(dto.target, sourceIssue.project);

    // Both issues must belong to the same project.
    if (targetIssue.projectId !== sourceIssue.projectId) {
      throw new NotFoundException(
        'Target issue does not belong to the same project',
      );
    }

    // Self-links are forbidden.
    if (targetIssue.id === sourceIssueId) {
      throw new BadRequestException('An issue cannot link to itself');
    }

    // ── Normalize: map inverse types to canonical storage form ────────────────
    //
    // We store only a canonical direction:
    //   BLOCKS       → stored as BLOCKS   (source=:id, target=targetId)
    //   BLOCKED_BY   → stored as BLOCKS   (source=targetId, target=:id)
    //   DUPLICATES   → stored as DUPLICATES (source=:id, target=targetId)
    //   DUPLICATED_BY→ stored as DUPLICATES (source=targetId, target=:id)
    //   CLONES       → stored as CLONES   (source=:id, target=targetId)
    //   RELATES_TO   → stored as RELATES_TO (source=:id, target=targetId, symmetric)
    //
    let storedType: IssueLinkType;
    let storedSourceId: string;
    let storedTargetId: string;

    const canonical = INVERSE_TO_CANONICAL[dto.type];
    if (canonical) {
      // Inverse type: swap source and target.
      storedType = canonical;
      storedSourceId = targetIssue.id;
      storedTargetId = sourceIssueId;
    } else {
      // Already canonical.
      storedType = dto.type;
      storedSourceId = sourceIssueId;
      storedTargetId = targetIssue.id;
    }

    // ── Duplicate detection ──────────────────────────────────────────────────
    //
    // We treat the following as duplicates:
    //  1. An existing row with (sourceId, targetId, type) = the normalized values.
    //  2. The same pair but with source/target swapped AND the inverse type stored
    //     (this is the "inverse duplicate" — e.g. a BLOCKS(A→B) when we try to
    //     store BLOCKS(B→A), which is logically the same link).
    //
    // Note: RELATES_TO is symmetric so a swap is the same logical link.
    //
    const existingDirect = await this.prisma.issueLink.findUnique({
      where: {
        sourceId_targetId_type: {
          sourceId: storedSourceId,
          targetId: storedTargetId,
          type: storedType,
        },
      },
    });
    if (existingDirect) {
      throw new ConflictException('This link already exists');
    }

    // Check the swapped direction with this or any other canonical type that
    // would be a logical duplicate. For asymmetric types we check if (targetId,
    // sourceId, storedType) already exists — that would mean the reverse link is
    // already stored (e.g. BLOCKS(B→A) exists when we want BLOCKS(A→B)).
    const existingSwapped = await this.prisma.issueLink.findFirst({
      where: {
        sourceId: storedTargetId,
        targetId: storedSourceId,
        type: storedType,
      },
    });
    if (existingSwapped) {
      throw new ConflictException(
        'An equivalent link in the opposite direction already exists',
      );
    }

    // For RELATES_TO, also block any existing RELATES_TO in either direction
    // (since it is symmetric, (A relates_to B) == (B relates_to A)).
    if (storedType === IssueLinkType.RELATES_TO) {
      const existingReverse = await this.prisma.issueLink.findUnique({
        where: {
          sourceId_targetId_type: {
            sourceId: storedTargetId,
            targetId: storedSourceId,
            type: IssueLinkType.RELATES_TO,
          },
        },
      });
      if (existingReverse) {
        throw new ConflictException('This link already exists');
      }
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const created = await this.prisma.issueLink.create({
      data: {
        sourceId: storedSourceId,
        targetId: storedTargetId,
        type: storedType,
        createdById: userId,
      },
      include: linkInclude,
    });

    // Return the link resolved from the caller's perspective (:id = sourceIssueId).
    return toIssueLinkDto(created as IssueLinkWithRefs, sourceIssueId);
  }

  async findAll(userId: string, issueId: string): Promise<IssueLinkDto[]> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    await assertProjectMember(this.prisma, userId, issue.projectId);

    // Fetch all links where the issue is either source or target.
    const links = await this.prisma.issueLink.findMany({
      where: {
        OR: [{ sourceId: issueId }, { targetId: issueId }],
      },
      include: linkInclude,
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });

    return links.map((l) => toIssueLinkDto(l as IssueLinkWithRefs, issueId));
  }

  async remove(userId: string, linkId: string): Promise<{ id: string }> {
    const link = await this.prisma.issueLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        sourceId: true,
        source: { select: { projectId: true } },
      },
    });
    if (!link) throw new NotFoundException('Issue link not found');

    // Membership check via the link's source issue project.
    await assertProjectRole(
      this.prisma,
      userId,
      link.source.projectId,
      Role.MEMBER,
    );

    await this.prisma.issueLink.delete({ where: { id: linkId } });
    return { id: linkId };
  }
}
