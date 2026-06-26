import { toUserDto } from '../auth/auth.service';
import { toStatusDto } from '../statuses/statuses.service';
import type {
  IssueDto,
  LabelDto,
  IssueType,
  Priority,
} from '@next-lane/shared';

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
  rank: string;
  createdAt: Date;
  updatedAt: Date;
  project?: { key: string } | null;
  status?: {
    id: string;
    name: string;
    category: string;
    order: number;
    projectId: string;
  } | null;
  assignee?: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
    createdAt: Date;
  } | null;
  reporter?: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
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
  _count?: { comments: number } | null;
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
    rank: issue.rank,
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

  return dto;
}
