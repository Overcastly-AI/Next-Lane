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
  DashboardGadgetVisualization,
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

/**
 * The authenticated user's own profile — `UserDto` plus fields that only
 * make sense for "yourself", never as an embedded reference on someone
 * else's data (a comment's author, an issue's assignee, an attachment's
 * uploader, etc. all stay plain `UserDto`). Returned by login/register,
 * `GET`/`PATCH /auth/me`, and the SSO/OIDC callback session.
 */
export interface MeDto extends UserDto {
  /** Instance-level admin flag — gates instance-wide settings (e.g. the in-app SSO/OIDC configuration screen), distinct from workspace-level `MembershipDto.role: ADMIN`. */
  isInstanceAdmin: boolean;
}

/** Body for PATCH /auth/me — updates the current user's own profile. */
export interface UpdateProfileDto {
  name?: string;
  emailNotifications?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: MeDto;
}

export interface MembershipDto {
  id: string;
  role: Role;
  user: UserDto;
}

/**
 * A project's EFFECTIVE member row: one per workspace member of the
 * project's workspace, combining their workspace-wide role with any
 * project-scoped `ProjectMembership` override.
 *
 * `effectiveRole` is what actually governs access to this project —
 * `workspaceRole` when `isOverride` is false, or the override's role when
 * true. See `apps/api/src/common/membership.util.ts` (`getEffectiveProjectRole`)
 * for the resolution rule (workspace admins always resolve to ADMIN,
 * unmarked, regardless of any stray override row).
 */
export interface ProjectMemberDto {
  userId: string;
  user: UserDto;
  /** The user's role in the project's workspace (Membership.role). */
  workspaceRole: Role;
  /** The role that actually applies for this project. */
  effectiveRole: Role;
  /** True when `effectiveRole` came from a per-project override, not the workspace role. */
  isOverride: boolean;
}

/** Body for `PUT /projects/:id/members/:userId/role` — set a project role override. */
export interface SetProjectRoleOverrideDto {
  role: Role;
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
  /** ISO 8601 date string (YYYY-MM-DD or full datetime), or null when no start date is set. */
  startDate: string | null;
  /** ISO 8601 date string (YYYY-MM-DD or full datetime), or null when no due date is set. */
  dueDate: string | null;
  rank: string;
  labels?: LabelDto[];
  commentCount?: number;
  /**
   * Number of unresolved blockers — issues linked as BLOCKS with this issue as
   * the target. Present on board payloads; > 0 means the card shows a "Blocked"
   * badge. Undefined when the caller didn't request the count.
   */
  blockedByCount?: number;
  /**
   * Aggregated GitHub PR + GitLab MR link summary for this issue — the
   * board card's "linked PR" badge. Counts open vs. merged separately
   * (closed links are excluded from both) so the card can distinguish
   * "in review" from "merged, transition pending". Present only on board
   * payloads (mirrors `blockedByCount`); undefined when the caller didn't
   * load the link relations.
   */
  prLinkSummary?: { open: number; merged: number };
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
  /** When true, the field value is pinned as a chip on board cards. */
  showOnCard: boolean;
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
  /**
   * Default swimlane group-by dimension applied when the board loads without
   * an explicit `?group=` URL param. One of the core dimension keys
   * (assignee/priority/type/epic/component/label/sprint) or `cf:<fieldId>`
   * for a project custom SELECT field. Null = flat board (no default grouping).
   */
  defaultGroupBy: string | null;
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
 * Cross-sprint velocity trend: the same committed/completed points per sprint
 * as {@link VelocityPointDto}, bounded to the project's most recent N
 * sprints (oldest → newest, suitable for the same grouped-bar chart the full
 * velocity report uses) — "are we speeding up or slowing down" without
 * opening each sprint's report individually.
 */
export interface VelocityTrendDto {
  projectId: string;
  /** Effective sprint count after clamping the requested value (1-24). */
  sprints: number;
  points: VelocityPointDto[];
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
  /**
   * True when the window came from the epic issue's own `startDate`/`dueDate`
   * (highest priority — takes precedence over both `fromSprints` and the
   * createdAt fallback, which are mutually exclusive with this flag).
   */
  fromOwnDates: boolean;
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
 * A user-defined quick link: a personal shortcut to an external URL (their own
 * apps/tools), shown in the header Quick Links menu. Personal to the caller and
 * persisted server-side so it follows them across devices.
 */
export interface QuickLinkDto {
  id: string;
  label: string;
  url: string;
  /** Optional hex accent color (e.g. "#2563eb"); null when unset. */
  color: string | null;
  /** Optional group name; links sharing one render together. null = ungrouped. */
  group: string | null;
  /** Display order (lower = first). */
  order: number;
  createdAt: string;
  updatedAt: string;
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
  /**
   * A project's mutable fields (name/key/description/archived state) changed.
   * Payload is the full `ProjectDto`. Emitted from update/archive/unarchive.
   */
  ProjectUpdated: 'project.updated',
  /** A project was permanently deleted. Payload is `{ id }`. */
  ProjectDeleted: 'project.deleted',
  /**
   * A dashboard's metadata (name/order) changed, or a gadget within it was
   * created/updated/deleted. Payload is `{ dashboardId }` — clients refetch
   * the affected dashboard's summary/detail/data queries rather than
   * receiving the full nested DTO. Emitted from `DashboardsService` on every
   * dashboard/gadget CRUD mutation.
   */
  DashboardUpdated: 'dashboard.updated',
  /**
   * A project's agent-context handoff document was created/replaced.
   * Payload is `{ projectId }` — clients refetch the agent-context query for
   * that project so an open "Agent context" view refreshes live. Emitted
   * from `AgentContextService.upsert`.
   */
  ProjectAgentContextUpdated: 'project-agent-context.updated',
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

// ── Instance-level admin settings: SSO/OIDC configuration screen ────────────

/**
 * Instance-wide SSO/OIDC configuration, as seen by the in-app admin settings
 * screen (`GET`/`PATCH /admin/oidc-config`, instance-admin gated).
 *
 * `envManaged: true` means `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/
 * `OIDC_CLIENT_SECRET` are all set in the environment — those values win over
 * any stored DB config, and the UI renders a read-only "env-managed" banner
 * instead of an editable form (a save would silently be overridden, so the
 * server rejects it outright rather than accepting a no-op write).
 *
 * `hasClientSecret` is the only signal about the secret ever returned — the
 * raw value (env or DB, encrypted or not) is never included in any response.
 */
export interface OidcConfigDto {
  envManaged: boolean;
  /** Effective enabled state: true whenever env-managed (env presence implies on), otherwise the DB row's own `enabled` flag. */
  enabled: boolean;
  issuerUrl: string | null;
  clientId: string | null;
  label: string;
  hasClientSecret: boolean;
  /** ISO timestamp of the last DB save; null when env-managed or never configured. */
  updatedAt: string | null;
}

/**
 * Body for `PATCH /admin/oidc-config`. Every field is optional — a partial
 * save (e.g. just flipping `enabled`) merges onto the existing stored row.
 * `clientSecret` is write-only: omit it to keep the currently-stored secret.
 */
export interface UpdateOidcConfigInput {
  enabled?: boolean;
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  label?: string;
}

// ── GitHub integration (Phase 9 — Developer Graph, v1 two-way link) ─────────

/** The kind of GitHub object an `IssueGithubLinkDto` points to. */
export const GITHUB_LINK_KINDS = ['PR', 'COMMIT', 'BRANCH'] as const;
export type GithubLinkKind = (typeof GITHUB_LINK_KINDS)[number];

/**
 * A project's GitHub repository link configuration.
 *
 * `webhookSecret` is included ONLY when the caller is an ADMIN (needed to
 * paste into GitHub's repo webhook settings); MEMBER/VIEWER callers receive
 * `webhookSecret: null` and `hasToken` only, never the secret or the token.
 * The raw PAT itself is NEVER returned by any endpoint after it is saved.
 */
export interface GithubIntegrationDto {
  id: string;
  projectId: string;
  repoFullName: string;
  /** Non-null only for ADMIN callers. */
  webhookSecret: string | null;
  /** Convenience field: the full inbound webhook URL to register with GitHub. */
  webhookUrl: string;
  /** Always true once configured — a token is required to save the integration. */
  hasToken: boolean;
  /**
   * When true, a `merged` PR webhook event auto-moves every linked issue to
   * `autoTransitionStatusId`, via the existing workflow-transition
   * enforcement path's automation-bypass flag. Off by default; visible to
   * every project member (not secret), unlike `webhookSecret`.
   */
  autoTransitionOnMerge: boolean;
  /** Target status id applied on merge when `autoTransitionOnMerge` is true. */
  autoTransitionStatusId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body for `PUT /projects/:projectId/github`. */
export interface UpsertGithubIntegrationInput {
  repoFullName: string;
  /** The raw GitHub PAT. Write-only — never echoed back. */
  token: string;
}

/** Body for `PATCH /projects/:projectId/github/automation`. */
export interface UpdateGithubAutomationInput {
  /** Turn the auto-transition-on-merge behavior on/off. */
  enabled: boolean;
  /**
   * Target status id. Required when enabling for the first time (no status
   * previously stored); omit to keep the currently-stored status while just
   * flipping `enabled`. Pass `null` to explicitly clear it (only valid
   * together with `enabled: false`).
   */
  statusId?: string | null;
}

/**
 * Live PR status for a single GitHub `IssueGithubLink` of kind `PR`, fetched
 * on demand (issue drawer open) via the real `GithubClient` outbound call —
 * the first live GitHub API call v1 makes. `error` is set (and every other
 * field null) when the live call fails for any reason (network, auth,
 * rate-limit, deleted PR) — the caller degrades gracefully rather than
 * failing the whole request.
 */
export interface GithubLiveLinkStatusDto {
  /** The `IssueGithubLink.id` this status is for. */
  linkId: string;
  /** The PR number (matches the link's `externalId`). */
  externalId: string;
  /** Live PR state, or null when the live call failed. */
  state: 'open' | 'closed' | null;
  /** Live merged flag, or null when the live call failed. */
  merged: boolean | null;
  /** Combined commit-status/CI rollup for the PR's head commit, or null when unavailable. */
  checksState: 'success' | 'failure' | 'pending' | 'unknown' | null;
  /** ISO 8601 timestamp this snapshot was fetched at. */
  fetchedAt: string;
  /** Human-readable reason the live call failed, or null on success. */
  error: string | null;
}

/**
 * A link between a tracked issue and a GitHub PR, commit, or branch, created
 * by the inbound webhook handler when a commit message or PR title/branch
 * name references the issue's key (e.g. "NL-123").
 */
export interface IssueGithubLinkDto {
  id: string;
  issueId: string;
  kind: GithubLinkKind;
  /** PR number (string), commit SHA, or branch name — depends on `kind`. */
  externalId: string;
  title: string | null;
  url: string;
  /** PR: "open" | "closed" | "merged". COMMIT/BRANCH: null. */
  state: string | null;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── GitLab integration (Phase 9 — Developer Graph, v1 two-way link) ─────────
//
// Parallel to the GitHub types above (same shape, GitLab semantics) rather
// than a shared provider-tagged type — see `GitlabIntegration`'s schema
// comment in `apps/api/prisma/schema.prisma` for the rationale.

/**
 * The kind of GitLab object an `IssueGitlabLinkDto` points to. "MR" (merge
 * request) is GitLab's name for what GitHub calls a "pull request".
 */
export const GITLAB_LINK_KINDS = ['MR', 'COMMIT', 'BRANCH'] as const;
export type GitlabLinkKind = (typeof GITLAB_LINK_KINDS)[number];

/**
 * A project's GitLab repository link configuration.
 *
 * `webhookSecret` is included ONLY when the caller is an ADMIN (needed to
 * paste into GitLab's webhook "Secret Token" field); MEMBER/VIEWER callers
 * receive `webhookSecret: null` and `hasToken` only, never the secret or the
 * token. The raw PAT itself is NEVER returned by any endpoint after it is
 * saved.
 */
export interface GitlabIntegrationDto {
  id: string;
  projectId: string;
  /** The GitLab instance origin, e.g. "https://gitlab.com" or a self-hosted URL. */
  gitlabBaseUrl: string;
  /** "namespace/project" path, may include nested subgroups. */
  projectPath: string;
  /** Non-null only for ADMIN callers. */
  webhookSecret: string | null;
  /** Convenience field: the full inbound webhook URL to register with GitLab. */
  webhookUrl: string;
  /** Always true once configured — a token is required to save the integration. */
  hasToken: boolean;
  /** Mirrors `GithubIntegrationDto.autoTransitionOnMerge` exactly. */
  autoTransitionOnMerge: boolean;
  autoTransitionStatusId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body for `PUT /projects/:projectId/gitlab`. */
export interface UpsertGitlabIntegrationInput {
  projectPath: string;
  /** Optional — server defaults to "https://gitlab.com" when omitted. */
  gitlabBaseUrl?: string;
  /** The raw GitLab PAT. Write-only — never echoed back. */
  token: string;
}

/** Body for `PATCH /projects/:projectId/gitlab/automation`. Mirrors `UpdateGithubAutomationInput`. */
export interface UpdateGitlabAutomationInput {
  enabled: boolean;
  statusId?: string | null;
}

/**
 * Live MR status for a single GitLab `IssueGitlabLink` of kind `MR`, fetched
 * on demand via the real `GitlabClient` outbound call. Mirrors
 * `GithubLiveLinkStatusDto`; `checksState` is derived from the MR's GitLab
 * CI pipeline status rather than a separate combined-status call (GitLab's
 * MR API embeds the latest pipeline inline).
 */
export interface GitlabLiveLinkStatusDto {
  linkId: string;
  externalId: string;
  state: 'open' | 'closed' | 'merged' | 'locked' | null;
  merged: boolean | null;
  checksState: 'success' | 'failure' | 'pending' | 'unknown' | null;
  fetchedAt: string;
  error: string | null;
}

/**
 * A link between a tracked issue and a GitLab MR, commit, or branch, created
 * by the inbound webhook handler when a commit message or MR title/
 * description/branch name references the issue's key (e.g. "NL-123").
 */
export interface IssueGitlabLinkDto {
  id: string;
  issueId: string;
  kind: GitlabLinkKind;
  /** MR `iid` (string), commit SHA, or branch name — depends on `kind`. */
  externalId: string;
  title: string | null;
  url: string;
  /** MR: "open" | "closed" | "merged" | "locked". COMMIT/BRANCH: null. */
  state: string | null;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Gitea integration (Phase 9 — Developer Graph, third self-hosted forge) ──
//
// Parallel to the GitHub/GitLab types above — same rationale as
// `IssueGitlabLinkDto`'s header comment. Gitea's webhook scheme is
// HMAC-SHA256 (`X-Gitea-Signature`, hex-encoded, no "sha256=" prefix), closer
// to GitHub's verification shape than GitLab's shared-secret-token compare.
// v1 deliberately has NO automation/live-status types — links only, no
// `autoTransitionOnMerge`/`autoTransitionStatusId` fields and no
// `GiteaLiveLinkStatusDto` (see `GiteaIntegration`'s schema comment).

/** The kind of Gitea object an `IssueGiteaLinkDto` points to. Mirrors `GithubLinkKind` — Gitea calls it "pull request" too. */
export const GITEA_LINK_KINDS = ['PR', 'COMMIT', 'BRANCH'] as const;
export type GiteaLinkKind = (typeof GITEA_LINK_KINDS)[number];

/**
 * A project's Gitea repository link configuration.
 *
 * `webhookSecret` is included ONLY when the caller is an ADMIN (needed to
 * paste into Gitea's repo webhook settings); MEMBER/VIEWER callers receive
 * `webhookSecret: null` and `hasToken` only, never the secret or the token.
 * The raw access token itself is NEVER returned by any endpoint after it is
 * saved.
 */
export interface GiteaIntegrationDto {
  id: string;
  projectId: string;
  /** The self-hosted Gitea instance origin — always required, no SaaS default. */
  giteaBaseUrl: string;
  /** "owner/repo" — mirrors GitHub's flat repo path shape. */
  repoFullName: string;
  /** Non-null only for ADMIN callers. */
  webhookSecret: string | null;
  /** Convenience field: the full inbound webhook URL to register with Gitea. */
  webhookUrl: string;
  /** Always true once configured — a token is required to save the integration. */
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Body for `PUT /projects/:projectId/gitea`. */
export interface UpsertGiteaIntegrationInput {
  giteaBaseUrl: string;
  repoFullName: string;
  /** The raw Gitea access token. Write-only — never echoed back. */
  token: string;
}

/**
 * A link between a tracked issue and a Gitea PR, commit, or branch, created
 * by the inbound webhook handler when a commit message or PR title/branch
 * name references the issue's key (e.g. "NL-123"). Mirrors
 * `IssueGithubLinkDto` exactly.
 */
export interface IssueGiteaLinkDto {
  id: string;
  issueId: string;
  kind: GiteaLinkKind;
  /** PR number (string), commit SHA, or branch name — depends on `kind`. */
  externalId: string;
  title: string | null;
  url: string;
  /** PR: "open" | "closed" | "merged". COMMIT/BRANCH: null. */
  state: string | null;
  authorLogin: string | null;
  createdAt: string;
  updatedAt: string;
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

// ── Public Dashboard Share Tokens ─────────────────────────────────────────────

/**
 * Metadata for a dashboard public share link (ADMIN view). Mirrors
 * `ShareTokenDto` but scoped to a dashboard instead of a project — dashboards
 * and project boards are separate share surfaces (a dashboard link never
 * grants board access and vice versa) backed by their own `DashboardShareToken`
 * table (see schema.prisma for the rationale).
 */
export interface DashboardShareTokenDto {
  id: string;
  dashboardId: string;
  createdById: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * Response from POST /dashboards/:id/share-tokens.
 * Contains the raw share URL token (shown ONCE — caller must copy it).
 */
export interface CreateDashboardShareTokenResponse {
  id: string;
  dashboardId: string;
  /** Raw "nls_..." token — shown exactly once and never retrievable again. */
  rawToken: string;
  createdAt: string;
}

/**
 * Read-only dashboard snapshot returned by the public (unauthenticated)
 * endpoint — every gadget's evaluated result, same shape as the authenticated
 * `GET /dashboards/:id/data` response, plus the minimal project/dashboard
 * metadata needed to render a standalone page (no auth-gated fields like
 * membership or gadget CRUD affordances).
 */
export interface PublicDashboardDto {
  project: {
    id: string;
    key: string;
    name: string;
  };
  dashboard: {
    id: string;
    name: string;
  };
  gadgets: DashboardGadgetResult[];
  issuesTruncated: boolean;
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
 * - `issues:read`    — GET endpoints for issues (list, single, activity) and
 *                       issue substructure that isn't its own scope: checklist
 *                       items, work logs, attachments (list/download),
 *                       notifications, and search results.
 * - `issues:write`   — POST/PATCH/DELETE on issues (create, update, move,
 *                       delete) and mutations to the same issue substructure:
 *                       checklist items, work logs, attachments
 *                       (upload/delete), notification read-state, creating an
 *                       issue from a template or personal-board card, and
 *                       issue-scoped label/version assignment
 *                       (`POST/DELETE /issues/:id/labels*`,
 *                       `PUT /issues/:id/versions`).
 * - `projects:read`  — GET project metadata and project-scoped structural /
 *                       config resources: statuses, labels, sprints, boards,
 *                       custom fields, components, versions, workflows,
 *                       dashboards, automations, poker sessions, standups,
 *                       saved filters, share tokens, roadmap, reports, and
 *                       project analytics.
 * - `projects:write` — POST/PATCH/DELETE on projects and the same
 *                       project-scoped structural/config resources listed
 *                       under `projects:read`.
 * - `webhooks:read`  — GET webhook subscriptions + delivery logs.
 * - `webhooks:write` — POST/PATCH/DELETE on webhook subscriptions.
 * - `comments:read`  — GET issue comments.
 * - `comments:write` — POST/PATCH/DELETE on comments.
 * - `github:read`    — GET the GitHub integration config + issue GitHub links
 *                       + the automation config + live PR/CI status.
 * - `github:write`   — PUT/DELETE the GitHub integration config + PATCH the
 *                       auto-transition-on-merge automation config.
 * - `gitlab:read`    — GET the GitLab integration config + issue GitLab links
 *                       + the automation config + live MR/pipeline status.
 * - `gitlab:write`   — PUT/DELETE the GitLab integration config + PATCH the
 *                       auto-transition-on-merge automation config.
 * - `gitea:read`     — GET the Gitea integration config + issue Gitea links.
 *                       No automation config / live-status scope — v1 has
 *                       neither (see `GiteaIntegrationDto`'s header comment).
 * - `gitea:write`    — PUT/DELETE the Gitea integration config.
 * - `workspaces:read`  — GET workspace metadata, member lists, the workspace
 *                         audit log, and the co-member user directory
 *                         (`GET /users*`).
 * - `workspaces:write` — POST/PATCH/DELETE on workspaces and workspace
 *                         membership (add/remove member, change role,
 *                         logo upload/delete).
 * - `admin:read`     — GET instance-wide admin settings (currently the
 *                       SSO/OIDC configuration screen). Distinct from
 *                       `workspaces:*`/`projects:*` because it is gated on
 *                       `User.isInstanceAdmin`, an instance-wide flag with no
 *                       workspace/project scoping.
 * - `admin:write`    — PATCH instance-wide admin settings.
 * - `tokens:read`    — GET the caller's own personal API tokens (metadata only).
 * - `tokens:write`   — POST (create) / DELETE (revoke) the caller's own
 *                       personal API tokens. Deliberately its own scope
 *                       rather than folded into an existing one: without it a
 *                       scoped-down token could mint itself a brand-new
 *                       *unrestricted* token and escape its own restrictions.
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
  'github:read',
  'github:write',
  'gitlab:read',
  'gitlab:write',
  'gitea:read',
  'gitea:write',
  'workspaces:read',
  'workspaces:write',
  'admin:read',
  'admin:write',
  'tokens:read',
  'tokens:write',
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
  /** Optional hex accent color (e.g. "#2563eb"); null when unset. */
  color: string | null;
  /** Optional due date (ISO 8601); null when unset. */
  dueDate: string | null;
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
  /** Optional hex accent color for the column header/border; null when unset. */
  color: string | null;
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
// CSV / Tracker Import
// ---------------------------------------------------------------------------

/**
 * The source tracker that produced the export file. Controls the pre-
 * normalisation step that maps tracker-specific column names and enum values
 * to Next Lane's canonical schema before the generic import pipeline runs.
 *
 * - `generic` (default) — Next Lane's own CSV export format (round-trip safe).
 * - `jira`    — Jira CSV export (Summary / Issue Type / Priority / Labels / etc.)
 * - `github`  — GitHub Issues CSV or JSON array (title / body / state / etc.)
 * - `linear`  — Linear CSV export (Title / Status / Priority / Estimate / etc.)
 *
 * All sources are **file-based only** — no live API calls are made.
 */
export type ImportSource = 'generic' | 'jira' | 'github' | 'linear';

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

/**
 * Optional request contract for `POST /projects/:projectId/issues/import`.
 * All fields are optional; `source` defaults to `'generic'` server-side.
 * Can be sent as a JSON body (with `csv`) or as query params alongside a
 * multipart upload.
 */
export interface ImportIssuesRequestDto {
  /** Raw CSV text (or JSON array for GitHub source). Required if no multipart file. */
  csv?: string;
  /** When true, validate rows only — no writes. Defaults to false. */
  dryRun?: boolean;
  /** Source tracker preset. Defaults to 'generic'. */
  source?: ImportSource;
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

// ---------------------------------------------------------------------------
// Dashboards (configurable, NLQL-native gadget framework)
// ---------------------------------------------------------------------------

/**
 * Visualization + grid-layout settings for a single gadget. Every field is
 * optional and interpreted per `visualization`:
 *  - BREAKDOWN: `field` (status/assignee/priority/type/label/component, or a
 *    custom SELECT field's key) — required to compute the gadget.
 *  - TABLE: `columns` (subset of key/title/status/assignee/points; defaults
 *    to all) and `limit` (max rows, server-capped).
 *  - VELOCITY_TREND: `sprints` (number of most-recent sprints to include,
 *    default 6, server-clamped to 1-24).
 *  - All gadgets: `position` (grid order — a fractional/midpoint numeric
 *    value so drag-to-reorder only ever updates the ONE moved gadget, never
 *    renumbers the rest) and `size` (grid span in columns; 1 = default,
 *    2 = wide).
 */
export interface DashboardGadgetConfig {
  position?: number;
  size?: number;
  field?: string;
  columns?: string[];
  limit?: number;
  sprints?: number;
}

/** A single gadget on a dashboard. */
export interface DashboardGadgetDto {
  id: string;
  dashboardId: string;
  title: string;
  /** NLQL query — the single source of truth for which issues this gadget covers. */
  query: string;
  visualization: DashboardGadgetVisualization;
  config: DashboardGadgetConfig;
  createdAt: string;
  updatedAt: string;
}

/** A dashboard summary — used in the per-project dashboard list. */
export interface DashboardSummaryDto {
  id: string;
  projectId: string;
  name: string;
  order: number;
  gadgetCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Full dashboard view: metadata + every gadget, ordered by config.position. */
export interface DashboardDto {
  id: string;
  projectId: string;
  name: string;
  order: number;
  gadgets: DashboardGadgetDto[];
  createdAt: string;
  updatedAt: string;
}

/** Body for POST /projects/:projectId/dashboards */
export interface CreateDashboardDto {
  name: string;
}

/** Body for PATCH /dashboards/:id */
export interface UpdateDashboardDto {
  name?: string;
  order?: number;
}

/** Body for POST /dashboards/:id/gadgets */
export interface CreateDashboardGadgetDto {
  title: string;
  query: string;
  visualization: DashboardGadgetVisualization;
  config?: DashboardGadgetConfig;
}

/** Body for PATCH /gadgets/:id */
export interface UpdateDashboardGadgetDto {
  title?: string;
  query?: string;
  visualization?: DashboardGadgetVisualization;
  config?: DashboardGadgetConfig;
}

/** A STAT gadget's computed data: a single count. */
export interface DashboardStatGadgetData {
  kind: 'STAT';
  count: number;
}

/** One row in a TABLE gadget. */
export interface DashboardTableRow {
  id: string;
  key: string;
  title: string;
  status: string;
  assignee: string | null;
  points: number | null;
}

/** A TABLE gadget's computed data: a capped list of matching issues. */
export interface DashboardTableGadgetData {
  kind: 'TABLE';
  columns: string[];
  rows: DashboardTableRow[];
  truncated: boolean;
}

/** One bucket in a BREAKDOWN gadget. */
export interface DashboardBreakdownBucket {
  key: string;
  count: number;
}

/** A BREAKDOWN gadget's computed data: counts grouped by `field`. */
export interface DashboardBreakdownGadgetData {
  kind: 'BREAKDOWN';
  field: string;
  buckets: DashboardBreakdownBucket[];
}

/**
 * A BURNDOWN gadget's computed data — the standard sprint burndown series,
 * scoped to the single sprint the gadget's query resolves to.
 */
export interface DashboardBurndownGadgetData {
  kind: 'BURNDOWN';
  sprintId: string;
  sprintName: string;
  totalCommitted: number;
  series: BurndownPointDto[];
}

/**
 * A VELOCITY_TREND gadget's computed data — committed vs completed story
 * points over the project's last N sprints. Project-wide: the gadget's NLQL
 * query is validated but not used to scope this (there's no single issue set
 * to filter — the trend spans every sprint's own issue set).
 */
export interface DashboardVelocityTrendGadgetData {
  kind: 'VELOCITY_TREND';
  sprints: number;
  points: VelocityPointDto[];
}

export type DashboardGadgetResultData =
  | DashboardStatGadgetData
  | DashboardTableGadgetData
  | DashboardBreakdownGadgetData
  | DashboardBurndownGadgetData
  | DashboardVelocityTrendGadgetData;

/**
 * One gadget's evaluated result within a dashboard's data payload. `data` is
 * present on success; `error` is present (and `data` absent) when the
 * gadget's stored NLQL query fails validation/evaluation or its config can't
 * be resolved (e.g. a BREAKDOWN gadget with an unknown `field`, or a
 * BURNDOWN gadget whose query doesn't resolve to exactly one sprint) — this
 * never surfaces as a 500, so one bad gadget can't break the whole dashboard.
 */
export interface DashboardGadgetResult {
  gadgetId: string;
  title: string;
  visualization: DashboardGadgetVisualization;
  config: DashboardGadgetConfig;
  data?: DashboardGadgetResultData;
  error?: string;
}

/** GET /dashboards/:id/data response — every gadget's evaluated result. */
export interface DashboardDataDto {
  dashboardId: string;
  gadgets: DashboardGadgetResult[];
  /** True when the project's issue set was capped before gadget evaluation. */
  issuesTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Agent context (per-project agent handoff memory)
//
// Founder directive (2026-07-03): "for each project a LLM via the MCP should
// be able to dump their context for the next run or agent." One shared
// markdown document per project — the handoff between separate agent runs
// (and, equally, a way for a human to leave notes for the next agent).
// ---------------------------------------------------------------------------

/** Minimal actor identity for `ProjectAgentContextDto.updatedBy`. */
export interface AgentContextUpdatedByDto {
  id: string;
  name: string;
}

/**
 * Staleness signal for a project's agent-context document: how much has
 * happened in the project since it was last written, so an agent (or human)
 * can judge whether to trust it as-is or reconcile against recent activity
 * first.
 *
 * `changesSinceUpdate` is an APPROXIMATE, honestly-scoped count — see
 * `AgentContextService.computeStaleness` for exactly what it counts (issue
 * field-change activity, comments, work logs, and project-scoped audit
 * events), not a guarantee of every possible change.
 */
export interface AgentContextStalenessDto {
  /** Count of project activity/audit entries newer than `updatedAt`. */
  changesSinceUpdate: number;
  /** Timestamp of the most recent counted activity, or null if none. */
  lastProjectActivityAt: string | null;
}

/** GET /projects/:id/agent-context response. */
export interface ProjectAgentContextDto {
  /** Markdown handoff document. Empty string when nothing has been written yet. */
  content: string;
  /** null when the document has never been written. */
  updatedAt: string | null;
  updatedBy: AgentContextUpdatedByDto | null;
  staleness: AgentContextStalenessDto;
}

/** Body for `PUT /projects/:id/agent-context`. */
export interface UpsertProjectAgentContextInput {
  content: string;
}

// ---------------------------------------------------------------------------
// Project activity feed (Agent Experience Round 2, criterion 6) — a
// project-wide "what changed" feed for agents that must not poll blind. Unifies
// three existing per-issue sources (ActivityLog field changes, Comment
// creation, WorkLog creation) into one chronologically-merged, cursor-paginated
// stream, so "did anything change since I last looked / did someone update
// NL-42" is one cheap call instead of N per-issue polls.
// ---------------------------------------------------------------------------

/** Discriminates which underlying table a `ProjectActivityItemDto` came from. */
export type ProjectActivityKind = 'ISSUE_FIELD' | 'COMMENT' | 'WORK_LOG';

/** One entry in a project's unified activity feed. */
export interface ProjectActivityItemDto {
  id: string;
  kind: ProjectActivityKind;
  issueId: string;
  /** Issue key, e.g. "NL-42" — resolved server-side so callers never need a join. */
  issueKey: string;
  actor: { id: string; name: string } | null;
  /**
   * Human-readable one-line summary, e.g. `status: To Do → In Progress`,
   * "commented", or "logged 45m". Cheap for an agent to skim without
   * interpreting `field`/`from`/`to` itself.
   */
  summary: string;
  /** Present for kind=ISSUE_FIELD only. */
  field?: string | null;
  from?: string | null;
  to?: string | null;
  createdAt: string;
}

/** GET /projects/:id/activity response. */
export interface PaginatedProjectActivityDto {
  items: ProjectActivityItemDto[];
  /** Opaque cursor for the next page, or null when there is no more. */
  nextCursor: string | null;
}
