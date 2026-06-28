/** Centralized TanStack Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  myWork: ['myWork'] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['unreadCount'] as const,
  workspaces: ['workspaces'] as const,
  workspaceMembers: (workspaceId: string) =>
    ['workspaceMembers', workspaceId] as const,
  users: ['users'] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  project: (projectId: string) => ['project', projectId] as const,
  /**
   * Legacy project-board key — used by `useBoardDefault` (the project default
   * board, fetched by projectId). New board-id-driven views use `qk.boardView`.
   */
  board: (projectId: string) => ['board', projectId] as const,
  /**
   * Board view keyed by the specific board id. This is the canonical key for
   * the board view cache once the user has selected (or been defaulted to) a
   * specific board. All optimistic mutations write here.
   */
  boardView: (boardId: string) => ['boardView', boardId] as const,
  /**
   * List of all boards for a project (for the board switcher).
   */
  boards: (projectId: string) => ['boards', projectId] as const,
  projectIssues: (projectId: string) => ['projectIssues', projectId] as const,
  issueSearch: (projectId: string, q: string) =>
    ['issueSearch', projectId, q] as const,
  issue: (issueId: string) => ['issue', issueId] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  activity: (issueId: string) => ['activity', issueId] as const,
  statuses: (projectId: string) => ['statuses', projectId] as const,
  sprints: (projectId: string) => ['sprints', projectId] as const,
  labels: (projectId: string) => ['labels', projectId] as const,
  attachments: (issueId: string) => ['attachments', issueId] as const,
  customFields: (projectId: string) => ['customFields', projectId] as const,
  components: (projectId: string) => ['components', projectId] as const,
  versions: (projectId: string) => ['versions', projectId] as const,
  pokerSessions: (projectId: string) => ['pokerSessions', projectId] as const,
  pokerSession: (sessionId: string) => ['pokerSession', sessionId] as const,
  issueLinks: (issueId: string) => ['issueLinks', issueId] as const,
  watchers: (issueId: string) => ['watchers', issueId] as const,
  checklist: (issueId: string) => ['checklist', issueId] as const,
};
