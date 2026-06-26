import type {
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
  Role,
  NotificationType,
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
 * One epic on the roadmap timeline. The date window is derived: from the
 * earliest start to the latest end of the sprints its child issues belong to;
 * when no child has a dated sprint, it falls back to the epic's own createdAt.
 * `start`/`end` are ISO datetimes, or null when no date context exists (the
 * epic then lands in the "No dates" lane). `progress` is the fraction (0–1) of
 * child issues currently in a DONE-category status.
 */
export interface RoadmapEpicDto {
  id: string;
  key: string; // e.g. "NL-12"
  title: string;
  /** The epic's own current status category, for tinting the row. */
  statusCategory: StatusCategory;
  childCount: number;
  doneCount: number;
  /** Fraction of children done (0–1); 0 when the epic has no children. */
  progress: number;
  /** Derived window start (ISO), or null when no date context. */
  start: string | null;
  /** Derived window end (ISO), or null when no date context. */
  end: string | null;
  /** True when the window came from child sprint dates (vs. createdAt fallback). */
  fromSprints: boolean;
}

/**
 * Full roadmap payload for a project: every epic (with derived windows and
 * progress) plus every sprint that has at least a start or end date, so the
 * client can render both lanes on a shared time axis.
 */
export interface RoadmapDto {
  projectId: string;
  epics: RoadmapEpicDto[];
  sprints: SprintDto[];
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

/**
 * A single issue in the "My Work" personal dashboard. Carries just enough to
 * render a row and navigate to the issue's board with its drawer open. Scoped
 * to the caller across every workspace/project they belong to.
 */
export interface MyWorkIssueDto {
  id: string;
  key: string; // e.g. "NL-12"
  number: number;
  title: string;
  type: IssueType;
  priority: Priority;
  projectId: string;
  projectKey: string;
  statusId: string;
  statusName: string;
  statusCategory: StatusCategory;
  /** Name of the sprint the issue belongs to, if any. */
  sprintName: string | null;
  /** State of the issue's sprint, if any (so the UI can flag active sprints). */
  sprintState: SprintState | null;
  updatedAt: string;
}

/**
 * The current user's work across all their workspaces/projects. Issues are
 * grouped by relationship to the caller. An issue can appear in both lists when
 * the user both reported and is assigned to it.
 */
export interface MyWorkDto {
  /** Issues currently assigned to the caller. */
  assigned: MyWorkIssueDto[];
  /** Issues the caller reported. */
  reported: MyWorkIssueDto[];
}

/**
 * A single notification (inbox item) for the current user. Carries denormalized
 * snapshot fields (issueKey, projectId) so the bell can render and navigate
 * without extra lookups. `actor` may be null if the user who caused it was
 * removed; `issueId` may be null if the source issue was deleted.
 */
export interface NotificationDto {
  id: string;
  type: NotificationType;
  actor: UserDto | null;
  issueId: string | null;
  issueKey: string;
  projectId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

/** Paginated list of the caller's notifications, newest first. */
export interface NotificationListDto {
  items: NotificationDto[];
  unreadCount: number;
}

/** Lightweight unread-count payload for the bell badge. */
export interface UnreadCountDto {
  count: number;
}

/** Realtime event names emitted over Socket.io. */
export const SocketEvents = {
  IssueCreated: 'issue.created',
  IssueUpdated: 'issue.updated',
  IssueMoved: 'issue.moved',
  IssueDeleted: 'issue.deleted',
  CommentCreated: 'comment.created',
  SprintUpdated: 'sprint.updated',
  NotificationCreated: 'notification.created',
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];
