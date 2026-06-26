-- Enforce the "one ACTIVE sprint per project" invariant at the database level.
-- A partial unique index makes concurrent sprint-start requests safe: only one
-- ACTIVE row per projectId can exist, regardless of application-level races.
-- (Partial indexes can't be expressed in schema.prisma, so this is raw SQL.)
CREATE UNIQUE INDEX "sprint_one_active_per_project" ON "Sprint"("projectId") WHERE state = 'ACTIVE';
