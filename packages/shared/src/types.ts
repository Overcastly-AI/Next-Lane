import type {
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
  Role,
} from './enums';

/** API DTO shapes shared between server and client. These mirror Prisma models
 *  but only expose fields the client is allowed to see. */

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface MembershipDto {
  id: string;
  role: Role;
  user: UserDto;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadId: string | null;
  workspaceId: string;
  archived: boolean;
  createdAt: string;
}

export interface StatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  order: number;
  projectId: string;
}

export interface LabelDto {
  id: string;
  name: string;
  color: string;
  projectId: string;
}

/** Lightweight summary of a related issue (parent or sub-task) for the drawer. */
export interface IssueRefDto {
  id: string;
  key: string; // e.g. "NL-12"
  type: IssueType;
  title: string;
  statusId: string;
  status?: StatusDto;
}

export interface IssueDto {
  id: string;
  key: string; // e.g. "NL-12"
  number: number;
  projectId: string;
  type: IssueType;
  title: string;
  description: string | null;
  statusId: string;
  status?: StatusDto;
  assigneeId: string | null;
  assignee?: UserDto | null;
  reporterId: string | null;
  reporter?: UserDto | null;
  priority: Priority;
  storyPoints: number | null;
  parentId: string | null;
  parent?: IssueRefDto | null;
  children?: IssueRefDto[];
  sprintId: string | null;
  rank: string;
  labels?: LabelDto[];
  commentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentDto {
  id: string;
  body: string;
  issueId: string;
  author: UserDto;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDto {
  id: string;
  issueId: string;
  actor: UserDto;
  field: string;
  from: string | null;
  to: string | null;
  createdAt: string;
}

export interface SprintDto {
  id: string;
  name: string;
  goal: string | null;
  state: SprintState;
  startDate: string | null;
  endDate: string | null;
  projectId: string;
}

export interface BoardDto {
  project: ProjectDto;
  statuses: StatusDto[];
  issues: IssueDto[];
}

/**
 * One bar in the velocity report: how many story points a sprint committed to
 * versus how many it actually completed (issues that ended in a DONE-category
 * status). Suitable for a grouped bar chart.
 */
export interface VelocityPointDto {
  sprintId: string;
  sprintName: string;
  state: SprintState;
  committed: number;
  completed: number;
}

/**
 * One day in a sprint's burndown: the ideal (linear) remaining points and the
 * actual remaining points derived from when issues transitioned into a
 * DONE-category status. `date` is an ISO date (YYYY-MM-DD).
 */
export interface BurndownPointDto {
  date: string;
  ideal: number;
  remaining: number;
}

/** Full burndown payload for a single sprint window. */
export interface BurndownDto {
  sprintId: string;
  sprintName: string;
  state: SprintState;
  startDate: string | null;
  endDate: string | null;
  /** Total committed story points (sum of issue storyPoints, nulls treated as 0). */
  totalCommitted: number;
  series: BurndownPointDto[];
}

/**
 * A single issue hit in a global/cross-project search. Lightweight by design:
 * just enough to render a result row and navigate to the issue's board with the
 * issue drawer open.
 */
export interface SearchIssueDto {
  id: string;
  key: string;
  number: number;
  title: string;
  projectId: string;
  projectKey: string;
  statusId: string;
  statusName: string;
  statusCategory: StatusCategory;
  type: IssueType;
}

/**
 * A single project hit in a global/cross-project search. Mirrors the fields a
 * result row needs to render and navigate to the project's board.
 */
export interface SearchProjectDto {
  id: string;
  key: string;
  name: string;
  workspaceId: string;
}

/**
 * Cross-project search results, scoped to the workspaces the caller belongs to.
 * Issues and projects are returned separately so the UI can group them.
 */
export interface SearchResultsDto {
  query: string;
  issues: SearchIssueDto[];
  projects: SearchProjectDto[];
}

/** Realtime event names emitted over Socket.io. */
export const SocketEvents = {
  IssueCreated: 'issue.created',
  IssueUpdated: 'issue.updated',
  IssueMoved: 'issue.moved',
  IssueDeleted: 'issue.deleted',
  CommentCreated: 'comment.created',
  SprintUpdated: 'sprint.updated',
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
