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
