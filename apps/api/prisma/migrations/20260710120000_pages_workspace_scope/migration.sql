-- Slice 1 of the org-level-docs epic: give every `Page` an always-present
-- `workspaceId`, and make `projectId` optional so a page can be workspace-
-- level (no single owning project) rather than always project-scoped.
--
-- Ordering keeps existing rows valid throughout: add the column nullable,
-- backfill it from the page's current project, THEN enforce NOT NULL + the
-- FK, and only after that relax `projectId` to nullable. This is safe to run
-- against a database that already has Page rows (every existing page has a
-- non-null projectId today, so the backfill fully populates workspaceId
-- before the NOT NULL constraint is added).
--
-- `Page.searchVector` (GENERATED ALWAYS AS ... STORED, added in
-- 20260709120000_add_pages_fts) and its GIN index are untouched by this
-- migration — neither depends on projectId/workspaceId.

-- Step (a): add the column nullable first.
ALTER TABLE "Page" ADD COLUMN "workspaceId" TEXT;

-- Step (b): backfill from the page's current project. Every existing Page
-- row has a non-null projectId today, so this fully populates workspaceId.
UPDATE "Page" p
SET "workspaceId" = proj."workspaceId"
FROM "Project" proj
WHERE proj.id = p."projectId";

-- Step (c): enforce NOT NULL now that every row is populated.
ALTER TABLE "Page" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Step (d): add the FK to Workspace, cascading so deleting a workspace
-- removes all of its pages (project-scoped or workspace-level alike).
ALTER TABLE "Page" ADD CONSTRAINT "Page_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Step (e): relax projectId to nullable — a workspace-level page has no
-- owning project. The existing "Page_projectId_fkey" (ON DELETE CASCADE,
-- added in 20260709000000_add_pages) is left in place unchanged; a nullable
-- column with a CASCADE FK is valid in Postgres (NULL simply never matches
-- the FK check) and still cascades correctly for rows that do have a project.
ALTER TABLE "Page" ALTER COLUMN "projectId" DROP NOT NULL;

-- Step (f): new indexes for workspace-level page queries, mirroring the
-- existing projectId-scoped ones.
CREATE INDEX "Page_workspaceId_parentId_idx" ON "Page"("workspaceId", "parentId");

CREATE INDEX "Page_workspaceId_rank_idx" ON "Page"("workspaceId", "rank");
