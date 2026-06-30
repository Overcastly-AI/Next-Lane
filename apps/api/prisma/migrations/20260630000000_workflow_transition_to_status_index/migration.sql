-- Migration: workflow_transition_to_status_index
-- Adds a composite index on (projectId, toStatusId) to WorkflowTransition to
-- speed up queries that ask "what transitions lead INTO a specific status for
-- a project?" — a common access pattern when rendering the workflow graph or
-- validating incoming transitions.
--
-- ADDITIVE ONLY — no existing rows, constraints, or columns are altered.

CREATE INDEX "WorkflowTransition_projectId_toStatusId_idx"
    ON "WorkflowTransition"("projectId", "toStatusId");
