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

/** Display + ordering metadata for priorities (highest first). */
export const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.HIGHEST]: 5,
  [Priority.HIGH]: 4,
  [Priority.MEDIUM]: 3,
  [Priority.LOW]: 2,
  [Priority.LOWEST]: 1,
};
