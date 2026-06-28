-- Migration: add_activitylog_status_index
-- Adds a composite index on ActivityLog(field, to, createdAt) to support the
-- completionMap raw query in AnalyticsService, which filters:
--   field = 'status'
--   to    = ANY(done-status-id array)
--   createdAt BETWEEN window_start AND window_end
--
-- Index design rationale:
--   (field, to) provides equality access on the two most-selective columns for
--   status-completion lookups ('status' appears on many transitions; the done-
--   status IDs are a small, known set). The trailing createdAt column then allows
--   a range scan inside the matched rows without an extra sort step.
--
--   An alternative (issueId, field, createdAt) would help per-issue point
--   lookups but is less selective for the ANY(...) array membership scan used
--   by this query. The planner can use this index alongside the existing
--   @@index([issueId]) for bitmap-and intersection when the issue set is large.

CREATE INDEX IF NOT EXISTS "ActivityLog_field_to_createdAt_idx"
    ON "ActivityLog" ("field", "to", "createdAt");
