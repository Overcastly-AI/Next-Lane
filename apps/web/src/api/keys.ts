/** Centralized TanStack Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  myWork: ['myWork'] as const,
  workspaces: ['workspaces'] as const,
  workspaceMembers: (workspaceId: string) =>
    ['workspaceMembers', workspaceId] as const,
  users: ['users'] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  board: (projectId: string) => ['board', projectId] as const,
  projectIssues: (projectId: string) => ['projectIssues', projectId] as const,
  issueSearch: (projectId: string, q: string) =>
    ['issueSearch', projectId, q] as const,
  issue: (issueId: string) => ['issue', issueId] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  activity: (issueId: string) => ['activity', issueId] as const,
  statuses: (projectId: string) => ['statuses', projectId] as const,
  sprints: (projectId: string) => ['sprints', projectId] as const,
  labels: (projectId: string) => ['labels', projectId] as const,
};
