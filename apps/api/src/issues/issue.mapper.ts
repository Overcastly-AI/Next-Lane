import { toUserDto } from '../auth/auth.service';
import { toStatusDto } from '../statuses/statuses.service';
import type {
  IssueDto,
  IssueRefDto,
  LabelDto,
  IssueType,
  Priority,
  CustomFieldValue,
} from '@next-lane/shared';
import { VersionState } from '@next-lane/shared';
import type { Prisma } from '@prisma/client';

/**
 * Shape of a Prisma Issue row with the relations the mapper consumes. All
 * relations are optional so callers can include only what they need.
 */
export interface IssueWithRelations {
  id: string;
  number: number;
  projectId: string;
  type: string;
  title: string;
  description: string | null;
  statusId: string;
  assigneeId: string | null;
  reporterId: string | null;
  priority: string;
  storyPoints: number | null;
  parentId: string | null;
  sprintId: string | null;
  dueDate: Date | null;
  rank: string;
  componentId: string | null;
  /** Raw JSONB from Prisma — typed as Prisma.JsonValue but we treat it as Record. */
  customFields?: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  project?: { key: string } | null;
  status?: {
    id: string;
    name: string;
    category: string;
    order: number;
    wipLimit?: number | null;
    projectId: string;
  } | null;
  assignee?: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    createdAt: Date;
  } | null;
  reporter?: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    emailNotifications: boolean;
    createdAt: Date;
  } | null;
  labels?: Array<{
    label: {
      id: string;
      name: string;
      color: string;
      projectId: string;
    };
  }>;
  versions?: Array<{
    version: {
      id: string;
      name: string;
      state: string;
    };
  }>;
  _count?: { comments: number } | null;
  parent?: IssueRef | null;
  children?: IssueRef[];
  component?: { id: string; name: string } | null;
}

/** Subset of an Issue row sufficient to build an IssueRefDto. */
interface IssueRef {
  id: string;
  number: number;
  type: string;
  title: string;
  statusId: string;
  project?: { key: string } | null;
  status?: {
    id: string;
    name: string;
    category: string;
    order: number;
    wipLimit?: number | null;
    projectId: string;
  } | null;
}

function toIssueRefDto(issue: IssueRef): IssueRefDto {
  const ref: IssueRefDto = {
    id: issue.id,
    key: issue.project ? `${issue.project.key}-${issue.number}` : `${issue.number}`,
    type: issue.type as IssueType,
    title: issue.title,
    statusId: issue.statusId,
  };
  if (issue.status) ref.status = toStatusDto(issue.status);
  return ref;
}

function toLabelDto(l: {
  id: string;
  name: string;
  color: string;
  projectId: string;
}): LabelDto {
  return { id: l.id, name: l.name, color: l.color, projectId: l.projectId };
}

export function toIssueDto(issue: IssueWithRelations): IssueDto {
  const dto: IssueDto = {
    id: issue.id,
    key: issue.project ? `${issue.project.key}-${issue.number}` : `${issue.number}`,
    number: issue.number,
    projectId: issue.projectId,
    type: issue.type as IssueType,
    title: issue.title,
    description: issue.description,
    statusId: issue.statusId,
    assigneeId: issue.assigneeId,
    reporterId: issue.reporterId,
    priority: issue.priority as Priority,
    storyPoints: issue.storyPoints,
    parentId: issue.parentId,
    sprintId: issue.sprintId,
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
    rank: issue.rank,
    componentId: issue.componentId,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };

  if (issue.status) dto.status = toStatusDto(issue.status);
  if (issue.assignee !== undefined)
    dto.assignee = issue.assignee ? toUserDto(issue.assignee) : null;
  if (issue.reporter !== undefined)
    dto.reporter = issue.reporter ? toUserDto(issue.reporter) : null;
  if (issue.labels) dto.labels = issue.labels.map((il) => toLabelDto(il.label));
  if (issue._count) dto.commentCount = issue._count.comments;
  if (issue.parent !== undefined)
    dto.parent = issue.parent ? toIssueRefDto(issue.parent) : null;
  if (issue.children) dto.children = issue.children.map(toIssueRefDto);
  if (issue.component !== undefined)
    dto.component = issue.component
      ? { id: issue.component.id, name: issue.component.name }
      : null;

  if (issue.versions) {
    dto.versions = issue.versions.map((iv) => ({
      id: iv.version.id,
      name: iv.version.name,
      state: iv.version.state as VersionState,
    }));
  }

  // Expose customFields when the column is present on the row. The stored JSON
  // is already keyed by CustomFieldDefinition.id with typed values. We cast
  // through unknown because Prisma types JsonValue broadly.
  if (issue.customFields != null) {
    dto.customFields = issue.customFields as unknown as Record<
      string,
      CustomFieldValue
    >;
  }

  return dto;
}
