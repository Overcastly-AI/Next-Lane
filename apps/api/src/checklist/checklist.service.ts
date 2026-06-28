import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { Role } from '@next-lane/shared';
import type { ChecklistItemDto } from '@next-lane/shared';
import {
  CreateChecklistItemDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';

export function toChecklistItemDto(item: {
  id: string;
  issueId: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: Date;
}): ChecklistItemDto {
  return {
    id: item.id,
    issueId: item.issueId,
    text: item.text,
    done: item.done,
    order: item.order,
    createdAt: item.createdAt.toISOString(),
  };
}

@Injectable()
export class ChecklistService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Load an issue (with its projectId) and throw 404 if not found.
   */
  private async getIssue(issueId: string): Promise<{ id: string; projectId: string }> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  /**
   * Load an item (with its issue's projectId) and throw 404 if not found.
   * This is the per-item tenant check: callers then call assertProjectMember/Role
   * against the resolved projectId.
   */
  private async getItem(
    itemId: string,
  ): Promise<{ id: string; issueId: string; projectId: string }> {
    const item = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
      select: { id: true, issueId: true, issue: { select: { projectId: true } } },
    });
    if (!item) throw new NotFoundException('Checklist item not found');
    return { id: item.id, issueId: item.issueId, projectId: item.issue.projectId };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async create(
    userId: string,
    issueId: string,
    dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const issue = await this.getIssue(issueId);
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    // Compute new item's order = max(order) + 1 for this issue (or 0 if first).
    const aggregate = await this.prisma.checklistItem.aggregate({
      where: { issueId },
      _max: { order: true },
    });
    const nextOrder = (aggregate._max.order ?? -1) + 1;

    const item = await this.prisma.checklistItem.create({
      data: {
        issueId,
        text: dto.text,
        done: false,
        order: nextOrder,
      },
    });

    return toChecklistItemDto(item);
  }

  async update(
    userId: string,
    itemId: string,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const itemRef = await this.getItem(itemId);
    await assertProjectRole(this.prisma, userId, itemRef.projectId, Role.MEMBER);

    const item = await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.done !== undefined ? { done: dto.done } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });

    return toChecklistItemDto(item);
  }

  async remove(userId: string, itemId: string): Promise<void> {
    const itemRef = await this.getItem(itemId);
    await assertProjectRole(this.prisma, userId, itemRef.projectId, Role.MEMBER);
    await this.prisma.checklistItem.delete({ where: { id: itemId } });
  }

  async reorder(
    userId: string,
    issueId: string,
    itemIds: string[],
  ): Promise<ChecklistItemDto[]> {
    const issue = await this.getIssue(issueId);
    await assertProjectRole(this.prisma, userId, issue.projectId, Role.MEMBER);

    // Validate all itemIds belong to this issue.
    const existing = await this.prisma.checklistItem.findMany({
      where: { issueId },
      select: { id: true },
    });
    const existingSet = new Set(existing.map((i) => i.id));
    for (const id of itemIds) {
      if (!existingSet.has(id)) {
        throw new NotFoundException(`Checklist item ${id} not found on this issue`);
      }
    }

    // Update each item's order to its position in itemIds.
    await Promise.all(
      itemIds.map((id, idx) =>
        this.prisma.checklistItem.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );

    const items = await this.prisma.checklistItem.findMany({
      where: { issueId },
      orderBy: { order: 'asc' },
    });

    return items.map(toChecklistItemDto);
  }

  async findAll(userId: string, issueId: string): Promise<ChecklistItemDto[]> {
    const issue = await this.getIssue(issueId);
    await assertProjectMember(this.prisma, userId, issue.projectId);

    const items = await this.prisma.checklistItem.findMany({
      where: { issueId },
      orderBy: { order: 'asc' },
    });

    return items.map(toChecklistItemDto);
  }
}
