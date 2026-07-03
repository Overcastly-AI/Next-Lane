/**
 * Re-exported from the shared `common/issue-key.util.ts` (extracted so the
 * GitLab integration — `gitlab/gitlab.service.ts` — reuses the exact same
 * extraction logic instead of a second copy). This file's public
 * behavior/import path is unchanged for existing callers/tests.
 */
export { extractIssueNumbers } from '../common/issue-key.util';
