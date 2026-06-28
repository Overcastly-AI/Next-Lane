-- Migration: add_configurable_workflows
-- Adds the WorkflowTransition table and the Project.workflowEnforced flag to
-- support per-project configurable status-transition graphs (Phase 2 / Phase 5).
--
-- Design notes:
--   * ADDITIVE ONLY — no existing columns, tables, or constraints are altered.
--   * Project.workflowEnforced defaults to false, making this fully backward-
--     compatible. Existing projects see no behavior change until they explicitly
--     opt in via the API.
--   * WorkflowTransition.fromStatusId is nullable. NULL means "from any status /
--     initial creation" (wildcard source). The service layer treats a NULL
--     fromStatusId row as matching any source status, and also as matching the
--     implicit create→initial transition.
--   * WorkflowTransition.issueType is nullable. NULL means the transition applies
--     to all issue types. A non-null value restricts it to a specific type,
--     enabling type-specific SDLC graphs within a single project.
--   * The @@unique([projectId, fromStatusId, toStatusId, issueType]) constraint
--     is expressed as a UNIQUE NULLS NOT DISTINCT index (Postgres 15+ / 16).
--     This project targets Postgres 16 (confirmed by the Docker Compose config
--     and the StandupEntry schema precedent). NULLS NOT DISTINCT ensures that
--     two rows with identical (projectId, NULL fromStatusId, toStatusId, NULL
--     issueType) collide correctly — without it, Postgres would treat each NULL
--     as distinct, allowing unlimited duplicate wildcard transitions and breaking
--     upsert semantics in the service layer.
--   * gates is JSONB (not a Postgres enum). Initial supported gate types are
--     documented in the model comment in schema.prisma. Keeping them as JSONB
--     means the vocabulary can expand (new gate types, new parameters) without
--     a schema migration — only an app-layer change is needed. A rigid PG enum
--     would require ALTER TYPE for every new gate kind.
--   * onDelete: Cascade on fromStatusId and toStatusId — if a status is deleted,
--     any transition referencing it (as source or destination) is removed. This
--     keeps the graph consistent. Project Cascade propagates to all transitions
--     when a project is deleted.

-- AlterTable: add the opt-in flag to Project (non-destructive, defaults false)
ALTER TABLE "Project"
    ADD COLUMN "workflowEnforced" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: the transition graph
CREATE TABLE "WorkflowTransition" (
    "id"           TEXT      NOT NULL,
    "projectId"    TEXT      NOT NULL,
    "fromStatusId" TEXT,
    "toStatusId"   TEXT      NOT NULL,
    "issueType"    "IssueType",
    "name"         TEXT,
    "gates"        JSONB     NOT NULL DEFAULT '[]',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: fast "what transitions are legal for this issue type?" lookup
CREATE INDEX "WorkflowTransition_projectId_issueType_idx"
    ON "WorkflowTransition"("projectId", "issueType");

-- CreateIndex: fast "what transitions can leave this status?" lookup
CREATE INDEX "WorkflowTransition_projectId_fromStatusId_idx"
    ON "WorkflowTransition"("projectId", "fromStatusId");

-- CreateUniqueIndex: prevent exact duplicate transitions.
-- NULLS NOT DISTINCT ensures (projectId, NULL, toStatusId, NULL) rows collide.
CREATE UNIQUE INDEX "WorkflowTransition_projectId_fromStatusId_toStatusId_issueType_key"
    ON "WorkflowTransition"("projectId", "fromStatusId", "toStatusId", "issueType")
    NULLS NOT DISTINCT;

-- AddForeignKey: WorkflowTransition → Project (Cascade)
ALTER TABLE "WorkflowTransition"
    ADD CONSTRAINT "WorkflowTransition_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: WorkflowTransition → Status (fromStatusId, nullable, Cascade)
ALTER TABLE "WorkflowTransition"
    ADD CONSTRAINT "WorkflowTransition_fromStatusId_fkey"
    FOREIGN KEY ("fromStatusId") REFERENCES "Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: WorkflowTransition → Status (toStatusId, Cascade)
ALTER TABLE "WorkflowTransition"
    ADD CONSTRAINT "WorkflowTransition_toStatusId_fkey"
    FOREIGN KEY ("toStatusId") REFERENCES "Status"("id") ON DELETE CASCADE ON UPDATE CASCADE;
