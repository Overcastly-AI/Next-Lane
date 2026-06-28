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

export const ISSUE_TYPES = Object.values(IssueType);
export const PRIORITIES = Object.values(Priority);
export const STATUS_CATEGORIES = Object.values(StatusCategory);
export const BOARD_TYPES = Object.values(BoardType);
export const CUSTOM_FIELD_TYPES = Object.values(CustomFieldType);

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
