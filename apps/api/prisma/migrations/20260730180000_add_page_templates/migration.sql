-- Doc templates ("page templates") — a reusable markdown skeleton for pages.
--
-- Scoping mirrors "Page" exactly: "workspaceId" always set, "projectId"
-- nullable (null = workspace-wide, offered for every page in the workspace
-- including pages inside a project).

CREATE TABLE "PageTemplate" (
    "id"            TEXT NOT NULL,
    "workspaceId"   TEXT NOT NULL,
    "projectId"     TEXT,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "titleTemplate" TEXT,
    "content"       TEXT NOT NULL DEFAULT '',
    "builtIn"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageTemplate_workspaceId_projectId_idx"
    ON "PageTemplate"("workspaceId", "projectId");
CREATE INDEX "PageTemplate_projectId_idx"
    ON "PageTemplate"("projectId");

-- Name uniqueness, as two PARTIAL unique indexes rather than one composite
-- UNIQUE (workspaceId, projectId, name).
--
-- Postgres treats NULLs as DISTINCT in a unique constraint, so the composite
-- form would place no constraint at all on workspace-wide rows (projectId IS
-- NULL) — two workspace templates both named 'Runbook' would be admitted.
-- That is precisely the collision worth preventing, so each scope gets its own
-- index over only the rows it applies to.
--
-- A project template MAY deliberately reuse a workspace template's name (a
-- local override); the picker labels each row's scope, so this is legible
-- rather than ambiguous.
CREATE UNIQUE INDEX "PageTemplate_workspace_name_key"
    ON "PageTemplate"("workspaceId", "name")
    WHERE "projectId" IS NULL;

CREATE UNIQUE INDEX "PageTemplate_project_name_key"
    ON "PageTemplate"("projectId", "name")
    WHERE "projectId" IS NOT NULL;

ALTER TABLE "PageTemplate"
    ADD CONSTRAINT "PageTemplate_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PageTemplate"
    ADD CONSTRAINT "PageTemplate_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Marker for "the built-in starters have been seeded into this workspace".
--
-- Left NULL for every existing workspace on purpose: that is exactly the set
-- the application-side backfill looks for on boot. Seeding is driven by this
-- column rather than by "the workspace has no templates", so a workspace whose
-- owner deleted all six starters does not get them resurrected on next restart.
ALTER TABLE "Workspace" ADD COLUMN "pageTemplatesSeededAt" TIMESTAMP(3);
