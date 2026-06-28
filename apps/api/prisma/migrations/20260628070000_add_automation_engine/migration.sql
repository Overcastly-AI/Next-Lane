-- Migration: add_automation_engine
-- Adds AutomationRule and AutomationRun for the Glass Box automation feature
-- (Phase 7). AutomationRule is project-scoped; AutomationRun is the immutable
-- per-evaluation audit trail.
--
-- Design notes:
--   * AutomationRule.createdById → User: SetNull — deleting a user preserves rules.
--   * AutomationRun.issueId     → Issue: SetNull — audit history survives issue deletion.
--   * AutomationRun.ruleId      → AutomationRule: Cascade — runs without a rule are meaningless.
--   * actions / actionsApplied stored as JSONB; no FK constraints into Label/Status/User
--     so that deleting referenced entities does not cascade-delete rules.

-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM (
    'ISSUE_CREATED',
    'ISSUE_UPDATED',
    'ISSUE_TRANSITIONED',
    'ISSUE_COMMENTED'
);

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM (
    'SUCCESS',
    'SKIPPED',
    'FAILED'
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "AutomationTrigger" NOT NULL,
    "condition" TEXT,
    "actions" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "issueId" TEXT,
    "trigger" "AutomationTrigger" NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "status" "AutomationRunStatus" NOT NULL,
    "actionsApplied" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: fast lookup when an event fires — filter by project + enabled flag.
CREATE INDEX "AutomationRule_projectId_enabled_idx" ON "AutomationRule"("projectId", "enabled");

-- CreateIndex: fast lookup by trigger type within a project.
CREATE INDEX "AutomationRule_projectId_trigger_idx" ON "AutomationRule"("projectId", "trigger");

-- CreateIndex
CREATE INDEX "AutomationRule_createdById_idx" ON "AutomationRule"("createdById");

-- CreateIndex: run-history viewer — most recent runs for a rule.
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- CreateIndex: run-history viewer — most recent runs for an issue.
CREATE INDEX "AutomationRun_issueId_createdAt_idx" ON "AutomationRun"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
