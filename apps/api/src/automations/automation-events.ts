/**
 * Domain event constants and payload types for the automation engine.
 *
 * Events are emitted by the issue/comment mutation seams (IssuesService,
 * CommentsService) via EventEmitter2 AFTER the successful mutation has
 * returned, so the engine never runs inside a DB transaction.
 *
 * The `automated` flag is the loop guard: when true the event came from an
 * automation action itself and must NOT re-trigger rule evaluation in v1
 * (no chaining). Every listener checks this flag first.
 */

import { AutomationTrigger } from '@next-lane/shared';

export const AUTOMATION_EVENTS = {
  ISSUE_CREATED: 'automation.issue.created',
  ISSUE_UPDATED: 'automation.issue.updated',
  ISSUE_TRANSITIONED: 'automation.issue.transitioned',
  ISSUE_COMMENTED: 'automation.issue.commented',
} as const satisfies Record<AutomationTrigger, string>;

/** Base payload common to all automation events. */
export interface AutomationEventBase {
  projectId: string;
  issueId: string;
  actorUserId: string;
  trigger: AutomationTrigger;
  /**
   * True when this mutation was itself applied by the automation engine.
   * Listeners MUST return immediately when this is true (loop guard).
   */
  automated: boolean;
}

/** Payload for ISSUE_CREATED. */
export interface IssueCreatedEvent extends AutomationEventBase {
  trigger: typeof AutomationTrigger.ISSUE_CREATED;
}

/** Payload for ISSUE_UPDATED. */
export interface IssueUpdatedEvent extends AutomationEventBase {
  trigger: typeof AutomationTrigger.ISSUE_UPDATED;
  /** Fields that changed (e.g. ['status', 'assignee']). */
  changedFields: string[];
}

/** Payload for ISSUE_TRANSITIONED (status change via move). */
export interface IssueTransitionedEvent extends AutomationEventBase {
  trigger: typeof AutomationTrigger.ISSUE_TRANSITIONED;
}

/** Payload for ISSUE_COMMENTED. */
export interface IssueCommentedEvent extends AutomationEventBase {
  trigger: typeof AutomationTrigger.ISSUE_COMMENTED;
}

export type AutomationEvent =
  | IssueCreatedEvent
  | IssueUpdatedEvent
  | IssueTransitionedEvent
  | IssueCommentedEvent;
