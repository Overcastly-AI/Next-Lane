/** Domain enums shared between the API and the web app. Keep in sync with the Prisma schema. */

export enum IssueType {
  TASK = 'TASK',
  BUG = 'BUG',
  STORY = 'STORY',
  EPIC = 'EPIC',
  SUBTASK = 'SUBTASK',
}

export enum Priority {
  LOWEST = 'LOWEST',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  HIGHEST = 'HIGHEST',
}

export enum StatusCategory {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
}

export enum SprintState {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}

export enum Role {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

/** Board view type. KANBAN = continuous flow; SCRUM = active-sprint focus. */
export enum BoardType {
  KANBAN = 'KANBAN',
  SCRUM = 'SCRUM',
}

/** Typed relationship between two issues. Keep in sync with the Prisma enum. */
export enum IssueLinkType {
  BLOCKS = 'BLOCKS',
  BLOCKED_BY = 'BLOCKED_BY',
  RELATES_TO = 'RELATES_TO',
  DUPLICATES = 'DUPLICATES',
  DUPLICATED_BY = 'DUPLICATED_BY',
  CLONES = 'CLONES',
}

export const ISSUE_LINK_TYPES = Object.values(IssueLinkType);

/** Human label for each link type, from the perspective of the source issue. */
export const ISSUE_LINK_TYPE_LABELS: Record<IssueLinkType, string> = {
  [IssueLinkType.BLOCKS]: 'blocks',
  [IssueLinkType.BLOCKED_BY]: 'is blocked by',
  [IssueLinkType.RELATES_TO]: 'relates to',
  [IssueLinkType.DUPLICATES]: 'duplicates',
  [IssueLinkType.DUPLICATED_BY]: 'is duplicated by',
  [IssueLinkType.CLONES]: 'clones',
};

/** The inverse relationship (how the target sees a link). RELATES_TO is symmetric. */
export const ISSUE_LINK_INVERSE: Record<IssueLinkType, IssueLinkType> = {
  [IssueLinkType.BLOCKS]: IssueLinkType.BLOCKED_BY,
  [IssueLinkType.BLOCKED_BY]: IssueLinkType.BLOCKS,
  [IssueLinkType.RELATES_TO]: IssueLinkType.RELATES_TO,
  [IssueLinkType.DUPLICATES]: IssueLinkType.DUPLICATED_BY,
  [IssueLinkType.DUPLICATED_BY]: IssueLinkType.DUPLICATES,
  [IssueLinkType.CLONES]: IssueLinkType.CLONES,
};

/** Custom field data types. Keep in sync with the Prisma CustomFieldType enum. */
export enum CustomFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  CHECKBOX = 'CHECKBOX',
  URL = 'URL',
}

/** Why a notification was created. Keep in sync with the Prisma schema. */
export enum NotificationType {
  ASSIGNED = 'ASSIGNED',
  MENTIONED = 'MENTIONED',
  COMMENTED = 'COMMENTED',
  WATCHED_UPDATED = 'WATCHED_UPDATED',
}

/**
 * How a dashboard gadget renders the issues its NLQL query matches.
 * Keep in sync with the Prisma `DashboardGadgetVisualization` enum.
 */
export enum DashboardGadgetVisualization {
  /** A single count. */
  STAT = 'STAT',
  /** A compact list of matching issues. */
  TABLE = 'TABLE',
  /** Counts grouped by a field (status/assignee/priority/type/label/component/custom). */
  BREAKDOWN = 'BREAKDOWN',
  /** Sprint burndown, scoped to the single sprint the query's issues belong to. */
  BURNDOWN = 'BURNDOWN',
}

export const ISSUE_TYPES = Object.values(IssueType);
export const PRIORITIES = Object.values(Priority);
export const STATUS_CATEGORIES = Object.values(StatusCategory);
export const BOARD_TYPES = Object.values(BoardType);
export const CUSTOM_FIELD_TYPES = Object.values(CustomFieldType);
export const DASHBOARD_GADGET_VISUALIZATIONS = Object.values(DashboardGadgetVisualization);

/** Display + ordering metadata for priorities (highest first). */
export const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.HIGHEST]: 5,
  [Priority.HIGH]: 4,
  [Priority.MEDIUM]: 3,
  [Priority.LOW]: 2,
  [Priority.LOWEST]: 1,
};

/**
 * Lifecycle state of a planning poker session.
 * Keep in sync with the Prisma `PokerState` enum.
 *
 * VOTING   — cards are hidden; participants submit their estimates.
 * REVEALED — facilitator has flipped cards; discussion phase.
 * CLOSED   — session is over; final estimates have been committed.
 */
export enum PokerState {
  VOTING = 'VOTING',
  REVEALED = 'REVEALED',
  CLOSED = 'CLOSED',
}

export const POKER_STATES = Object.values(PokerState);

/**
 * Standard planning poker deck. Matches the card labels stored in
 * `PokerVote.value`. The "☕" card means "need a break / can't estimate".
 */
export const POKER_DECK = [
  '0',
  '1',
  '2',
  '3',
  '5',
  '8',
  '13',
  '21',
  '34',
  '55',
  '89',
  '?',
  '☕',
] as const;

export type PokerCard = (typeof POKER_DECK)[number];

/**
 * The issue lifecycle events an automation rule can react to. Mirrors the
 * Prisma `AutomationTrigger` enum and the seams in the issue/comment services.
 */
export enum AutomationTrigger {
  ISSUE_CREATED = 'ISSUE_CREATED',
  ISSUE_UPDATED = 'ISSUE_UPDATED',
  ISSUE_TRANSITIONED = 'ISSUE_TRANSITIONED',
  ISSUE_COMMENTED = 'ISSUE_COMMENTED',
}

export const AUTOMATION_TRIGGERS = Object.values(AutomationTrigger);

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  [AutomationTrigger.ISSUE_CREATED]: 'Issue created',
  [AutomationTrigger.ISSUE_UPDATED]: 'Issue updated',
  [AutomationTrigger.ISSUE_TRANSITIONED]: 'Issue changes status',
  [AutomationTrigger.ISSUE_COMMENTED]: 'Comment added',
};

/**
 * The things an automation rule can do when it fires. Each action carries a
 * small `params` object whose shape depends on the type (validated server-side):
 *  - ASSIGN            → { assigneeId: string | null }   (null = unassign)
 *  - SET_PRIORITY      → { priority: Priority }
 *  - TRANSITION        → { statusId: string }
 *  - ADD_LABEL         → { labelId: string }
 *  - ADD_COMMENT       → { body: string }
 *  - SET_CUSTOM_FIELD  → { fieldId: string, value: unknown }
 */
export enum AutomationActionType {
  ASSIGN = 'ASSIGN',
  SET_PRIORITY = 'SET_PRIORITY',
  TRANSITION = 'TRANSITION',
  ADD_LABEL = 'ADD_LABEL',
  ADD_COMMENT = 'ADD_COMMENT',
  SET_CUSTOM_FIELD = 'SET_CUSTOM_FIELD',
}

export const AUTOMATION_ACTION_TYPES = Object.values(AutomationActionType);

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  [AutomationActionType.ASSIGN]: 'Assign to',
  [AutomationActionType.SET_PRIORITY]: 'Set priority',
  [AutomationActionType.TRANSITION]: 'Move to status',
  [AutomationActionType.ADD_LABEL]: 'Add label',
  [AutomationActionType.ADD_COMMENT]: 'Add comment',
  [AutomationActionType.SET_CUSTOM_FIELD]: 'Set custom field',
};

/** Outcome of a single automation rule evaluation against one event. */
export enum AutomationRunStatus {
  /** Condition matched and all actions applied. */
  SUCCESS = 'SUCCESS',
  /** Condition did not match; no actions taken. */
  SKIPPED = 'SKIPPED',
  /** Condition matched but one or more actions threw. */
  FAILED = 'FAILED',
}

export const AUTOMATION_RUN_STATUSES = Object.values(AutomationRunStatus);

/**
 * Gate/validator types for a workflow transition. A gate is checked before a
 * transition is allowed; if it fails, the move is rejected with a reason.
 * Kept as a string enum (stored in `WorkflowTransition.gates` JSON as `type`)
 * so the vocabulary can grow without a schema migration.
 *  - REQUIRE_ASSIGNEE        — the issue must have an assignee
 *  - REQUIRE_DESCRIPTION     — the issue description must be non-empty
 *  - REQUIRE_FIELD           — a given field/custom-field key must be set (params.field)
 *  - REQUIRE_LINK            — the issue must have a link of a given type (params.linkType)
 *  - REQUIRE_NO_OPEN_BLOCKERS — no incoming "blocked by" links may be unresolved
 */
export enum WorkflowGateType {
  REQUIRE_ASSIGNEE = 'REQUIRE_ASSIGNEE',
  REQUIRE_DESCRIPTION = 'REQUIRE_DESCRIPTION',
  REQUIRE_FIELD = 'REQUIRE_FIELD',
  REQUIRE_LINK = 'REQUIRE_LINK',
  REQUIRE_NO_OPEN_BLOCKERS = 'REQUIRE_NO_OPEN_BLOCKERS',
}

export const WORKFLOW_GATE_TYPES = Object.values(WorkflowGateType);

export const WORKFLOW_GATE_LABELS: Record<WorkflowGateType, string> = {
  [WorkflowGateType.REQUIRE_ASSIGNEE]: 'Require an assignee',
  [WorkflowGateType.REQUIRE_DESCRIPTION]: 'Require a description',
  [WorkflowGateType.REQUIRE_FIELD]: 'Require a field to be set',
  [WorkflowGateType.REQUIRE_LINK]: 'Require a link of a type',
  [WorkflowGateType.REQUIRE_NO_OPEN_BLOCKERS]: 'Block if open blockers remain',
};

/**
 * Lifecycle state of a version/release.
 * Keep in sync with the Prisma `VersionState` enum.
 *
 * UNRELEASED — the version is planned but not yet released.
 * RELEASED   — the version has been shipped; releaseDate is set.
 * ARCHIVED   — the version is no longer active.
 */
export enum VersionState {
  UNRELEASED = 'UNRELEASED',
  RELEASED = 'RELEASED',
  ARCHIVED = 'ARCHIVED',
}

export const VERSION_STATES = Object.values(VersionState);

/** Human label for each version state. */
export const VERSION_STATE_LABELS: Record<VersionState, string> = {
  [VersionState.UNRELEASED]: 'Unreleased',
  [VersionState.RELEASED]: 'Released',
  [VersionState.ARCHIVED]: 'Archived',
};
