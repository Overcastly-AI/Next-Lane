-- Migration: add_per_board_workflows_time_tracking_issue_templates
-- Applied: 2026-06-29
--
-- Feature 1: Per-board workflows
--   - New Workflow model (project-scoped named workflow)
--   - WorkflowTransition.workflowId (nullable, for named-workflow rows)
--   - Board.workflowId (nullable, links board to a named Workflow)
--   - Second unique index on WorkflowTransition for workflow-scoped rows
--
-- Feature 2: Time tracking
--   - Issue.originalEstimateMinutes (nullable Int)
--   - New WorkLog model
--
-- Feature 3: Issue templates
--   - New IssueTemplate model
--
-- All changes are additive and backward-compatible.

-- AlterTable: Board — add optional workflowId column
ALTER TABLE "Board" ADD COLUMN "workflowId" TEXT;

-- AlterTable: Issue — add optional originalEstimateMinutes column
ALTER TABLE "Issue" ADD COLUMN "originalEstimateMinutes" INTEGER;

-- AlterTable: WorkflowTransition — add optional workflowId column
ALTER TABLE "WorkflowTransition" ADD COLUMN "workflowId" TEXT;

-- CreateTable: Workflow
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WorkLog
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "workedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: IssueTemplate
CREATE TABLE "IssueTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issueType" "IssueType" NOT NULL DEFAULT 'TASK',
    "titleTemplate" TEXT,
    "descriptionTemplate" TEXT,
    "priority" "Priority",
    "defaultAssigneeId" TEXT,
    "componentId" TEXT,
    "labelIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Workflow
CREATE INDEX "Workflow_projectId_idx" ON "Workflow"("projectId");
CREATE UNIQUE INDEX "Workflow_projectId_name_key" ON "Workflow"("projectId", "name");

-- CreateIndex: WorkLog
CREATE INDEX "WorkLog_issueId_idx" ON "WorkLog"("issueId");
CREATE INDEX "WorkLog_userId_idx" ON "WorkLog"("userId");

-- CreateIndex: IssueTemplate
CREATE INDEX "IssueTemplate_projectId_idx" ON "IssueTemplate"("projectId");
CREATE UNIQUE INDEX "IssueTemplate_projectId_name_key" ON "IssueTemplate"("projectId", "name");

-- CreateIndex: Board.workflowId
CREATE INDEX "Board_workflowId_idx" ON "Board"("workflowId");

-- CreateIndex: WorkflowTransition.workflowId
CREATE INDEX "WorkflowTransition_workflowId_idx" ON "WorkflowTransition"("workflowId");

-- CreateIndex: second unique on WorkflowTransition for workflow-scoped rows
-- Postgres 16 NULLS NOT DISTINCT: two rows with same (workflowId, NULL fromStatusId,
-- toStatusId, NULL issueType) will collide correctly.
CREATE UNIQUE INDEX "WorkflowTransition_workflowId_fromStatusId_toStatusId_issue_key"
    ON "WorkflowTransition"("workflowId", "fromStatusId", "toStatusId", "issueType");

-- AddForeignKey: Board → Workflow (SetNull on Workflow delete)
ALTER TABLE "Board" ADD CONSTRAINT "Board_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: WorkflowTransition → Workflow (Cascade on Workflow delete)
ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Workflow → Project (Cascade on Project delete)
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: WorkLog → Issue (Cascade on Issue delete)
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: WorkLog → User (Cascade on User delete)
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: IssueTemplate → Project (Cascade on Project delete)
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: IssueTemplate → User (SetNull on User delete)
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_defaultAssigneeId_fkey"
    FOREIGN KEY ("defaultAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: IssueTemplate → Component (SetNull on Component delete)
ALTER TABLE "IssueTemplate" ADD CONSTRAINT "IssueTemplate_componentId_fkey"
    FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;
