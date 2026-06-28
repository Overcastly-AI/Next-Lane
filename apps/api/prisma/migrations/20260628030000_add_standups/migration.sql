-- Migration: add_standups
-- Adds StandupEntry and StandupBlockerLink for async daily standups.

-- CreateTable
CREATE TABLE "StandupEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "yesterday" TEXT,
    "today" TEXT,
    "blockers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandupEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandupBlockerLink" (
    "id" TEXT NOT NULL,
    "standupEntryId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandupBlockerLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: composite unique — one entry per user per (team, project) scope per day.
-- Postgres 16 uses NULLS NOT DISTINCT so NULL teamId / NULL projectId values
-- are treated as equal within the index, preventing duplicate scope entries.
CREATE UNIQUE INDEX "StandupEntry_userId_teamId_projectId_date_key"
    ON "StandupEntry"("userId", "teamId", "projectId", "date") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "StandupEntry_teamId_date_idx" ON "StandupEntry"("teamId", "date");

-- CreateIndex
CREATE INDEX "StandupEntry_projectId_date_idx" ON "StandupEntry"("projectId", "date");

-- CreateIndex
CREATE INDEX "StandupEntry_userId_date_idx" ON "StandupEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StandupBlockerLink_standupEntryId_issueId_key"
    ON "StandupBlockerLink"("standupEntryId", "issueId");

-- CreateIndex
CREATE INDEX "StandupBlockerLink_standupEntryId_idx" ON "StandupBlockerLink"("standupEntryId");

-- CreateIndex
CREATE INDEX "StandupBlockerLink_issueId_idx" ON "StandupBlockerLink"("issueId");

-- AddForeignKey
ALTER TABLE "StandupEntry" ADD CONSTRAINT "StandupEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupEntry" ADD CONSTRAINT "StandupEntry_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupEntry" ADD CONSTRAINT "StandupEntry_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupBlockerLink" ADD CONSTRAINT "StandupBlockerLink_standupEntryId_fkey"
    FOREIGN KEY ("standupEntryId") REFERENCES "StandupEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupBlockerLink" ADD CONSTRAINT "StandupBlockerLink_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
