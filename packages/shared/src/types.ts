import type {
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
  Role,
  NotificationType,
  BoardType,
  CustomFieldType,
  PokerState,
  IssueLinkType,
  AutomationTrigger,
  AutomationActionType,
  AutomationRunStatus,
  WorkflowGateType,
  VersionState,
} from './enums';

/** API DTO shapes shared between server and client. These mirror Prisma models
 *  but only expose fields the client is allowed to see. */

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  createdAt: string;
  emailNotifications: boolean;
}

/** Body for PATCH /auth/me — updates the current user's own profile. */
export interface UpdateProfileDto {
  name?: string;
  emailNotifications?: boolean;
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
  /** Accent color as `#RRGGBB`, or null to use the product default. */
  brandColor: string | null;
  /**
   * URL to fetch the workspace's custom logo image, or null when none is set.
   * Relative to the API base (e.g. `/workspaces/:id/logo`); the client
   * prefixes the configured API URL and may append a cache-busting param.
   */
  logoUrl: string | null;
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
  /** When true, only defined WorkflowTransitions are legal (opt-in SDLC). */
  workflowEnforced: boolean;
}

export interface StatusDto {
  id: string;
  name: string;
  category: StatusCategory;
  order: number;
  projectId: string;
  /** Optional WIP limit for this column; null means no limit. */
  wipLimit: number | null;
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
  /** ISO 8601 date string (YYYY-MM-DD or full datetime), or null when no due date is set. */
  dueDate: string | null;
  rank: string;
  labels?: LabelDto[];
  commentCount?: number;
  /**
   * Custom field values, keyed by CustomFieldDefinition.id. Value shape depends
   * on the field type (string | number | boolean | string[] | ISO date string).
   * Absent keys mean "no value set". Only present when the issue is loaded with
   * custom fields.
   */
  customFields?: Record<string, CustomFieldValue>;
  /** Component this issue belongs to. Null means no component assigned. */
  componentId: string | null;
  /** Lightweight component summary for board cards and the drawer. */
  component?: { id: string; name: string } | null;
  /**
   * Versions this issue targets (M:N). Present when the issue is loaded with
   * the versions relation. An empty array means no version targeted.
   */
  versions?: { id: string; name: string; state: VersionState }[];
  /**
   * Checklist items for this issue, ordered by `order` asc.
   * Present when the issue is loaded with the checklist relation.
   */
  checklist?: ChecklistItemDto[];
  /**
   * Derived progress summary: how many checklist items are done vs. total.
   * Only present when `checklist` is loaded.
   */
  checklistProgress?: { done: number; total: number };
  /**
   * Original time estimate in minutes; null when not estimated.
   * Maps directly to the `Issue.originalEstimateMinutes` DB column.
   */
  originalEstimateMinutes: number | null;
  /**
   * Total minutes logged against this issue (sum of WorkLog.minutes).
   * Present when the issue is loaded with work logs; 0 when no logs exist.
   */
  timeSpentMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** A project-scoped component (area) grouping issues together. */
export interface ComponentDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  defaultAssignee: UserDto | null;
  createdAt: string;
}

/** Body for POST /projects/:projectId/components */
export interface CreateComponentDto {
  name: string;
  description?: string;
  defaultAssigneeId?: string | null;
}

/** Body for PATCH /components/:id */
export interface UpdateComponentDto {
  name?: string;
  description?: string | null;
  defaultAssigneeId?: string | null;
}

// ---------------------------------------------------------------------------
// Versions / Releases
// ---------------------------------------------------------------------------

/** A project-scoped release target (e.g. "v1.2.0"). */
export interface VersionDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  state: VersionState;
  /** ISO 8601 datetime string, or null when no release date is set. */
  releaseDate: string | null;
  /** Count of issues targeting this version. Present on list responses. */
  issueCount?: number;
  createdAt: string;
}

/** Body for POST /projects/:projectId/versions */
export interface CreateVersionDto {
  name: string;
  description?: string | null;
  /** ISO 8601 date/datetime string, or null to clear. */
  releaseDate?: string | null;
}

/** Body for PATCH /versions/:id */
export interface UpdateVersionDto {
  name?: string;
  description?: string | null;
  state?: VersionState;
  /** ISO 8601 date/datetime string, or null to clear. */
  releaseDate?: string | null;
}

/** A single custom field value. Shape depends on the field's type. */
export type CustomFieldValue = string | number | boolean | string[] | null;

/**
 * A typed link between two issues, resolved from the perspective of the issue
 * being viewed. `type`/`label` describe how the viewed issue relates to
 * `relatedIssue` (e.g. type=BLOCKS, label="blocks", relatedIssue=NL-5).
 */
export interface IssueLinkDto {
  id: string;
  type: IssueLinkType;
  /** Human label from the viewer's perspective (e.g. "is blocked by"). */
  label: string;
  relatedIssue: IssueRefDto;
  createdAt: string;
}

/** A project-defined custom field. Mirrors the CustomFieldDefinition model. */
export interface CustomFieldDefinitionDto {
  id: string;
  projectId: string;
  /** Human label, e.g. "Severity". */
  name: string;
  /** Stable machine key used in NLQL and as the storage key, e.g. "severity". */
  key: string;
  type: CustomFieldType;
  /** Options for SELECT / MULTI_SELECT (empty for other types). */
  options: string[];
  /** If non-empty, the field only applies to these issue types. Empty = all types. */
  appliesToTypes: IssueType[];
  required: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A page of issues from `GET /issues`. `nextCursor` is an opaque token to pass
 * back as the `cursor` query param to fetch the following page; `null` means
 * there are no more results.
 */
export interface PaginatedIssuesDto {
  items: IssueDto[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Checklist items
// ---------------------------------------------------------------------------

export interface ChecklistItemDto {
  id: string;
  issueId: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: string;
}

/** Body for POST /issues/:issueId/checklist */
export interface CreateChecklistItemDto {
  text: string;
}

/** Body for PATCH /checklist/:itemId */
export interface UpdateChecklistItemDto {
  text?: string;
  done?: boolean;
  order?: number;
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

/**
 * One conditional card-color rule on a board. The card adopts `color` when an
 * issue matches the NLQL `query`. Rules are evaluated in array order and the
 * first match wins. (The `query`/coloring behaviour is wired in a later slice;
 * the shape is defined here so the Board contract is stable.)
 */
export interface BoardColorRule {
  id: string;
  /** NLQL condition; an issue matching it adopts this rule's color. */
  query: string;
  /** Hex color applied to the card accent (e.g. "#ef4444"). */
  color: string;
  /** Short human label shown in the board's color legend. */
  label?: string;
}

/** Summary of a board for the project's board switcher / list. */
export interface BoardSummaryDto {
  id: string;
  projectId: string;
  name: string;
  type: BoardType;
  isDefault: boolean;
  order: number;
  /** NLQL filter saved on the board (null = no saved filter). */
  filterQuery: string | null;
  colorRules: BoardColorRule[];
  /**
   * ID of the named Workflow this board enforces, or null to fall back to the
   * project-level legacy workflowEnforced flag.
   */
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardDto {
  /** The board this view belongs to (null only for legacy/default fallback). */
  board: BoardSummaryDto;
  project: ProjectDto;
  statuses: StatusDto[];
  issues: IssueDto[];
  /**
   * True when the board's issue list was capped at the server-side limit and
   * more issues exist that are not shown. The UI should surface a hint so users
   * know results are partial.
   */
  issuesTruncated: boolean;
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
 * One day in a Cumulative Flow Diagram: the count of issues in each status
 * category on that calendar day. `date` is an ISO date (YYYY-MM-DD). Suitable
 * for a stacked-area chart.
 */
export interface CfdPointDto {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

/**
 * Full CFD payload for a project over a rolling day window. `statuses` gives
 * the display names resolved from the project's own status categories so the
 * chart can label the legend bands.
 */
export interface CfdDto {
  projectId: string;
  days: number;
  series: CfdPointDto[];
}

/**
 * The field changes a bulk-edit applies to every selected issue. All fields
 * optional — only the provided ones change. `assigneeId`/`sprintId` accept null
 * to clear (unassign / remove from sprint); `addLabelIds` adds labels without
 * removing existing ones.
 */
export interface BulkIssueChangesDto {
  statusId?: string;
  assigneeId?: string | null;
  priority?: Priority;
  sprintId?: string | null;
  type?: IssueType;
  addLabelIds?: string[];
}

/** Request body for a bulk issue update. `ids` is capped server-side. */
export interface BulkUpdateIssuesDto {
  ids: string[];
  changes: BulkIssueChangesDto;
}

/** Result of a bulk update: how many succeeded, and per-id failures. */
export interface BulkUpdateResultDto {
  updated: number;
  failed: { id: string; reason: string }[];
}

/**
 * One day in a flow series: how many issues were created versus how many
 * reached a DONE-category status on that calendar day. `date` is an ISO date
 * (YYYY-MM-DD). Suitable for a created-vs-resolved line or area chart.
 */
export interface FlowPointDto {
  date: string;
  created: number;
  completed: number;
}

/** A count of completed issues bucketed by how long they took (created → done). */
export interface CycleTimeBucketDto {
  /** Human label for the bucket, e.g. "<1d", "1–3d", "3–7d", "1–2w", ">2w". */
  bucket: string;
  count: number;
}

/** Open-issue load carried by a single assignee (plus an "Unassigned" row). */
export interface WorkloadRowDto {
  /** Assignee user id, or null for the synthetic "Unassigned" bucket. */
  userId: string | null;
  name: string;
  open: number;
}

/** A count of open issues grouped by a categorical field (type or priority). */
export interface CategoryCountDto {
  key: string;
  count: number;
}

/**
 * Personal analytics for the signed-in user over a rolling day window. Covers
 * the issues assigned to them across all projects plus their personal board.
 * `avgCycleTimeDays` is null when nothing completed in the window.
 */
export interface PersonalAnalyticsDto {
  days: number;
  assigned: {
    /** Assigned to me and not in a DONE-category status. */
    open: number;
    /** Assigned to me and reached DONE within the window. */
    completed: number;
    /** Open + dueDate in the past. */
    overdue: number;
  };
  /** Per-day completed count over the window (assigned to me). */
  throughput: FlowPointDto[];
  avgCycleTimeDays: number | null;
  /** Open issues assigned to me, grouped by issue type. */
  byType: CategoryCountDto[];
  /** Open issues assigned to me, grouped by priority. */
  byPriority: CategoryCountDto[];
  personalBoard: {
    totalCards: number;
    promoted: number;
    createdInWindow: number;
  };
}

/**
 * Team analytics for a single project over a rolling day window — the
 * delivery-flow companion to the sprint-centric reports. `avgCycleTimeDays`
 * is null when nothing completed in the window.
 */
export interface ProjectAnalyticsDto {
  projectId: string;
  days: number;
  /** Per-day created vs completed across the window. */
  flow: FlowPointDto[];
  createdTotal: number;
  completedTotal: number;
  avgCycleTimeDays: number | null;
  /** Distribution of cycle times for issues completed in the window. */
  cycleTime: CycleTimeBucketDto[];
  /** Open issues by assignee, busiest first. */
  workload: WorkloadRowDto[];
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
  /**
   * True when the epic list was capped at the server-side limit and more epics
   * exist that are not shown. The UI should surface a hint so users know
   * results are partial.
   */
  epicsTruncated: boolean;
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
  /** ISO 8601 datetime string, or null when no due date is set. */
  dueDate: string | null;
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

/**
 * A single viewer currently looking at a project board.
 * Emitted as part of `presence.update` events.
 */
export interface PresenceViewer {
  userId: string;
  name: string;
  avatarColor: string;
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
  PresenceUpdate: 'presence.update',
} as const;

export type SocketEvent = (typeof SocketEvents)[keyof typeof SocketEvents];

/**
 * Domain event types that outbound webhooks can subscribe to. These mirror the
 * realtime event names so a single dispatch point feeds both channels.
 */
export const WebhookEventTypes = {
  IssueCreated: 'issue.created',
  IssueUpdated: 'issue.updated',
  IssueMoved: 'issue.moved',
  IssueDeleted: 'issue.deleted',
  CommentCreated: 'comment.created',
  SprintStarted: 'sprint.started',
  SprintCompleted: 'sprint.completed',
} as const;

export type WebhookEventType =
  (typeof WebhookEventTypes)[keyof typeof WebhookEventTypes];

/** The full list of subscribable webhook event types, for UI checkboxes. */
export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] =
  Object.values(WebhookEventTypes);

// ── Attachments ─────────────────────────────────────────────────────────────

/**
 * Metadata for a single file attachment on an issue.
 * The storageKey is intentionally omitted — callers download via the REST URL.
 */
export interface AttachmentDto {
  id: string;
  issueId: string;
  uploaderId: string;
  uploader: UserDto;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * A registered outbound webhook endpoint. `secret` is never returned by the API
 * after creation (write-only); `events` empty means "all events".
 */
export interface WebhookSubscriptionDto {
  id: string;
  projectId: string;
  url: string;
  events: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

/** A single delivery-log entry for a webhook subscription. */
export interface WebhookDeliveryDto {
  id: string;
  subscriptionId: string;
  event: string;
  status: 'success' | 'failed';
  responseStatus: number | null;
  error: string | null;
  createdAt: string;
}

/** The JSON body POSTed to a subscriber's URL for each event. */
export interface WebhookEventPayload {
  event: WebhookEventType;
  projectId: string;
  timestamp: string;
  data: unknown;
}

// ── Workspace Audit Log ──────────────────────────────────────────────────────

/**
 * A single workspace-level audit event.
 * Immutable record of a security- or governance-relevant action.
 * `actor` is null when the actor has been deleted or the event was system-generated.
 */
export interface AuditEventDto {
  id: string;
  workspaceId: string;
  actor: { id: string; name: string; email: string } | null;
  action: string; // e.g. "membership.add", "project.create", "token.revoke"
  targetType: string; // e.g. "Membership", "Project", "ApiToken"
  targetId: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/**
 * Cursor-paginated page of audit events for a workspace.
 * `nextCursor` is null when there are no more results.
 */
export interface PaginatedAuditEventsDto {
  items: AuditEventDto[];
  nextCursor: string | null;
}

// ── Public Share Tokens ──────────────────────────────────────────────────────

/**
 * Metadata for a project public share link (ADMIN view).
 * The raw token is returned only on creation; only the hash is stored.
 */
export interface ShareTokenDto {
  id: string;
  projectId: string;
  createdById: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Response from POST /projects/:id/share-tokens.
 * Contains the raw share URL token (shown ONCE — caller must copy it).
 */
export interface CreateShareTokenResponse {
  id: string;
  projectId: string;
  /** Raw "nls_..." token — shown exactly once and never retrievable again. */
  rawToken: string;
  createdAt: string;
}

/**
 * Read-only board snapshot returned by the public (unauthenticated) endpoint.
 * Minimal fields needed to render the board; no members, comments, or attachments.
 */
export interface PublicBoardDto {
  project: {
    id: string;
    key: string;
    name: string;
  };
  statuses: StatusDto[];
  issues: IssueDto[];
}

// ── Saved Filters ─────────────────────────────────────────────────────────────

/**
 * A saved NLQL filter. Mirrors the SavedFilter table. `projectId` is null for a
 * cross-project (global) filter; `shared` exposes the filter to other members of
 * the owning scope (project/workspace) rather than just the owner.
 */
export interface SavedFilterDto {
  id: string;
  name: string;
  /** NLQL query string. */
  query: string;
  ownerId: string;
  /** null = the filter is not scoped to a single project. */
  projectId: string | null;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Personal API Tokens (PATs) ───────────────────────────────────────────────

/**
 * The complete vocabulary of PAT scope strings.
 *
 * Design notes:
 * - Format: `<resource>:<action>` — keeps them readable and easily matched.
 * - `issues:read`    — GET endpoints for issues (list, single, activity).
 * - `issues:write`   — POST/PATCH/DELETE on issues (create, update, move, delete).
 * - `projects:read`  — GET project metadata, statuses, labels, sprints.
 * - `projects:write` — POST/PATCH/DELETE on projects, statuses, labels, sprints.
 * - `webhooks:read`  — GET webhook subscriptions + delivery logs.
 * - `webhooks:write` — POST/PATCH/DELETE on webhook subscriptions.
 * - `comments:read`  — GET issue comments.
 * - `comments:write` — POST/PATCH/DELETE on comments.
 *
 * An empty `scopes` array on a token means "unrestricted" (same as a browser
 * JWT session — all routes are accessible). Only non-empty scopes arrays are
 * enforced by `@RequireScope`.
 */
export const PAT_SCOPES = [
  'issues:read',
  'issues:write',
  'projects:read',
  'projects:write',
  'webhooks:read',
  'webhooks:write',
  'comments:read',
  'comments:write',
] as const;

export type PATScope = (typeof PAT_SCOPES)[number];

/**
 * Metadata for an existing personal API token.
 * The raw token and its hash are never returned after creation.
 */
export interface ApiTokenDto {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Granted scopes. Empty array = unrestricted (full owner permissions). */
  scopes: string[];
}

/**
 * Response from POST /me/tokens.
 * Contains the raw token (shown ONCE — caller must copy it immediately)
 * plus the token metadata.
 */
export interface CreateApiTokenResponse {
  id: string;
  name: string;
  /** Raw "nlp_..." token — shown exactly once and never retrievable again. */
  rawToken: string;
  expiresAt: string | null;
  createdAt: string;
  /** Granted scopes. Empty array = unrestricted. */
  scopes: string[];
}

// ── Planning Poker ────────────────────────────────────────────────────────────

/**
 * One participant's vote on a single PokerItem.
 * Hidden from other participants until the item or session is revealed.
 * `value` is a deck card label (see `POKER_DECK`).
 */
export interface PokerVoteDto {
  id: string;
  itemId: string;
  userId: string;
  /** Card label from the standard deck, e.g. "5", "13", "?", "☕". */
  value: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One issue being estimated within a PokerSession.
 * `revealed` indicates whether the facilitator has flipped this item's cards.
 * `finalEstimate` is null until the facilitator commits the agreed story-point value.
 */
export interface PokerItemDto {
  id: string;
  sessionId: string;
  issueId: string;
  order: number;
  revealed: boolean;
  /** Committed story points; null until the facilitator commits an estimate. */
  finalEstimate: number | null;
  createdAt: string;
  /** Votes cast for this item. Present only when the item is loaded with votes. */
  votes?: PokerVoteDto[];
}

// ── Async Standups ────────────────────────────────────────────────────────────

/**
 * Links a standup entry's blockers to a specific tracked issue.
 * Embedded in `StandupEntryDto.blockerLinks` when loaded with relations.
 */
export interface StandupBlockerLinkDto {
  id: string;
  standupEntryId: string;
  issueId: string;
  /** The linked issue, present when loaded with the `issue` relation. */
  issue?: IssueRefDto;
  createdAt: string;
}

/**
 * A daily async standup entry submitted by a user.
 *
 * Scope: scoped to a Team, a Project, or both. At least one of `teamId` /
 * `projectId` is non-null (validated at the service layer).
 *
 * `date` is an ISO date string (YYYY-MM-DD) representing the standup calendar
 * day. The server normalises to midnight UTC before persisting.
 *
 * `blockerIssueIds` is a flat list of issue IDs referenced as blockers — a
 * convenience projection of `blockerLinks[].issueId` for callers that only
 * need the IDs. `blockerLinks` carries full link objects including the
 * resolved `IssueRefDto` when the server loads the relation.
 */
export interface StandupEntryDto {
  id: string;
  userId: string;
  /** null when the entry is project-scoped only. */
  teamId: string | null;
  /** null when the entry is team-scoped only. */
  projectId: string | null;
  /** ISO date string YYYY-MM-DD for the standup calendar day. */
  date: string;
  yesterday: string | null;
  today: string | null;
  blockers: string | null;
  /** Flat list of issue IDs linked as blockers (convenience projection). */
  blockerIssueIds: string[];
  /** Full blocker link objects; present when loaded with the `blockerLinks` relation. */
  blockerLinks?: StandupBlockerLinkDto[];
  /** Resolved author; present when loaded with the `user` relation. */
  user?: UserDto;
  createdAt: string;
  updatedAt: string;
}

// ── Personal Boards ───────────────────────────────────────────────────────────

/**
 * A single card within a personal kanban column.
 * `promotedIssueId` is non-null when the card has been promoted to a real
 * tracked issue. `notes` is the optional free-text body of the card.
 */
export interface PersonalCardDto {
  id: string;
  columnId: string;
  title: string;
  notes: string | null;
  /** Fractional-index rank for ordering within the column (same scheme as Issue.rank). */
  rank: string;
  /** ID of the Issue this card was promoted to, or null when not yet promoted. */
  promotedIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A user-owned kanban column in the private personal board.
 * `order` is a stable integer position (lower = further left).
 * `cards` is present only when the column is loaded with its cards.
 */
export interface PersonalColumnDto {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  /** Cards in this column, present when loaded with the `cards` relation. */
  cards?: PersonalCardDto[];
}

/**
 * A planning poker estimation session, scoped to a project and optionally a sprint.
 *
 * `activeItemId` — the PokerItem.id currently open for voting, or null when
 * no item is active (e.g. between items or before the session starts).
 * Application-managed; not enforced as a DB FK.
 *
 * `items` — present only when the session is loaded with its items.
 */
export interface PokerSessionDto {
  id: string;
  projectId: string;
  sprintId: string | null;
  name: string | null;
  state: PokerState;
  /** ID of the PokerItem currently being voted on, or null. */
  activeItemId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  /** Items belonging to this session. Present only when loaded with items. */
  items?: PokerItemDto[];
}

// ---------------------------------------------------------------------------
// Automation engine
// ---------------------------------------------------------------------------

/**
 * One action in an automation rule. `type` selects the behaviour; `params`
 * carries the type-specific configuration (validated server-side). See
 * `AutomationActionType` for the per-type param shapes.
 */
export interface AutomationActionDto {
  type: AutomationActionType;
  params: Record<string, unknown>;
}

/**
 * A project-scoped automation rule: when `trigger` fires and the optional
 * NLQL `condition` matches the issue, the ordered `actions` run. `condition`
 * is null for an unconditional rule.
 */
export interface AutomationRuleDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger: AutomationTrigger;
  condition: string | null;
  actions: AutomationActionDto[];
  /** Evaluation order within the project (ascending). */
  order: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single thing an automation actually did, for the run audit trail. */
export interface AutomationRunActionDto {
  type: string;
  detail: string;
}

/**
 * One Glass Box audit entry: the record of a rule being evaluated against a
 * single event. `matched` is whether the condition passed; `status` is the
 * overall outcome; `actionsApplied` enumerates what happened.
 */
export interface AutomationRunDto {
  id: string;
  ruleId: string;
  /** Denormalized for the run-history view; present when loaded with the rule. */
  ruleName?: string;
  issueId: string | null;
  /** Denormalized issue key (e.g. "NL-42"); present when resolvable. */
  issueKey?: string | null;
  trigger: AutomationTrigger;
  matched: boolean;
  status: AutomationRunStatus;
  actionsApplied: AutomationRunActionDto[];
  error: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Configurable workflows (SDLC transition graph)
// ---------------------------------------------------------------------------

/**
 * A single gate/validator on a workflow transition. `type` selects the check;
 * the optional params carry type-specific config (validated server-side):
 *  - REQUIRE_FIELD → { field: string }   (issue field or custom-field key)
 *  - REQUIRE_LINK  → { linkType: string }
 * Others take no params.
 */
export interface WorkflowGateDto {
  type: WorkflowGateType;
  field?: string;
  linkType?: string;
}

/**
 * One allowed transition in a project's workflow graph. `fromStatusId === null`
 * means "from any status" (also used for the create→initial transition).
 * `issueType === null` means the transition applies to every issue type.
 * `workflowId` is null for legacy project-level transitions; non-null for
 * transitions that belong to a named Workflow.
 */
export interface WorkflowTransitionDto {
  id: string;
  projectId: string;
  fromStatusId: string | null;
  toStatusId: string;
  issueType: IssueType | null;
  name: string | null;
  gates: WorkflowGateDto[];
  /** null = legacy project-level transition; non-null = belongs to a named Workflow. */
  workflowId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The project-level workflow configuration: the enforcement flag plus the
 * legacy transition graph. When `enforced` is false, every transition is
 * permitted regardless of the list (backward-compatible default).
 *
 * @deprecated Prefer the named-workflow `WorkflowDto` for new work. This
 *   alias is kept for backward compatibility with the existing
 *   GET/PATCH /projects/:id/workflow endpoints.
 */
export type ProjectWorkflowConfigDto = {
  projectId: string;
  enforced: boolean;
  transitions: WorkflowTransitionDto[];
};

/**
 * A named, project-scoped workflow definition (the new Workflow model).
 * Boards can be associated with a named workflow instead of the legacy
 * project-level `workflowEnforced` flag. `transitionCount` and `boardCount`
 * are optional rollup fields present on list responses.
 */
export interface WorkflowDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  enforced: boolean;
  /** Number of transitions defined in this workflow (optional, list responses). */
  transitionCount?: number;
  /** Number of boards currently using this workflow (optional, list responses). */
  boardCount?: number;
  createdAt: string;
}

/** Body for POST /projects/:projectId/workflows */
export interface CreateWorkflowDto {
  name: string;
  description?: string;
  enforced?: boolean;
}

/** Body for PATCH /workflows/:id */
export interface UpdateWorkflowDto {
  name?: string;
  description?: string;
  enforced?: boolean;
}

// ---------------------------------------------------------------------------
// Time Tracking — WorkLog
// ---------------------------------------------------------------------------

/**
 * A logged time entry for an issue. `workedAt` is when the work was performed;
 * `note` is an optional free-text summary of what was done.
 */
export interface WorkLogDto {
  id: string;
  issueId: string;
  userId: string;
  /** Resolved user who logged the time. */
  user: UserDto;
  /** Duration in minutes. */
  minutes: number;
  note: string | null;
  /** ISO 8601 datetime: when the work was performed. */
  workedAt: string;
  /** ISO 8601 datetime: when the log entry was created. */
  createdAt: string;
}

/** Body for POST /issues/:issueId/worklogs */
export interface CreateWorkLogDto {
  /** Duration in minutes (required, must be > 0). */
  minutes: number;
  note?: string;
  /** ISO 8601 datetime; defaults to now when omitted. */
  workedAt?: string;
}

/** Body for PATCH /worklogs/:id */
export interface UpdateWorkLogDto {
  minutes?: number;
  note?: string;
  /** ISO 8601 datetime. */
  workedAt?: string;
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------

/**
 * One row-level error from a CSV import. `row` is 1-based (header = row 0,
 * first data row = row 1).
 */
export interface ImportIssueRowError {
  row: number;
  message: string;
}

/**
 * Response from `POST /projects/:projectId/issues/import`.
 *
 * `created`  — number of issues successfully created.
 * `skipped`  — number of rows skipped (header or fully empty rows).
 * `errors`   — per-row validation / resolution errors. Invalid rows are NOT
 *              imported; the import continues with the remaining valid rows.
 * `dryRun`   — reflects whether the request was a dry run (no writes).
 */
export interface ImportIssuesResultDto {
  created: number;
  skipped: number;
  errors: ImportIssueRowError[];
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Issue Templates
// ---------------------------------------------------------------------------

/**
 * A project-scoped template for pre-populating new issue fields.
 * `labelIds` is the list of Label IDs to apply when creating from this template.
 */
export interface IssueTemplateDto {
  id: string;
  projectId: string;
  name: string;
  issueType: IssueType;
  titleTemplate: string | null;
  descriptionTemplate: string | null;
  priority: Priority | null;
  defaultAssignee: UserDto | null;
  componentId: string | null;
  /** Label IDs to apply when creating an issue from this template. */
  labelIds: string[];
  createdAt: string;
}

/** Body for POST /projects/:projectId/issue-templates */
export interface CreateIssueTemplateDto {
  name: string;
  issueType?: IssueType;
  titleTemplate?: string;
  descriptionTemplate?: string;
  priority?: Priority;
  defaultAssigneeId?: string | null;
  componentId?: string | null;
  labelIds?: string[];
}

/** Body for PATCH /issue-templates/:id */
export interface UpdateIssueTemplateDto {
  name?: string;
  issueType?: IssueType;
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
  priority?: Priority | null;
  defaultAssigneeId?: string | null;
  componentId?: string | null;
  labelIds?: string[];
}
