-- NOTE: `prisma migrate dev`'s diff engine spuriously proposes dropping
-- "Issue_customFields_gin_idx" / "Issue_searchVector_idx" and clearing the
-- GENERATED ALWAYS AS STORED default on "Issue"."searchVector" on every new
-- migration, because those objects are raw-SQL-managed (Prisma cannot
-- express GENERATED STORED columns or GIN indexes natively — see the
-- baseline_v2 migration's raw SQL section) and therefore invisible to its
-- schema model, not because this migration touches full-text search in any
-- way. Those statements have been removed from this file; do not re-add them.

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "rank" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "lastEditedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageIssueLink" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageLink" (
    "id" TEXT NOT NULL,
    "sourcePageId" TEXT NOT NULL,
    "targetPageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Page_projectId_parentId_idx" ON "Page"("projectId", "parentId");

-- CreateIndex
CREATE INDEX "Page_projectId_rank_idx" ON "Page"("projectId", "rank");

-- CreateIndex
CREATE INDEX "PageVersion_pageId_versionNumber_idx" ON "PageVersion"("pageId", "versionNumber" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PageVersion_pageId_versionNumber_key" ON "PageVersion"("pageId", "versionNumber");

-- CreateIndex
CREATE INDEX "PageIssueLink_pageId_idx" ON "PageIssueLink"("pageId");

-- CreateIndex
CREATE INDEX "PageIssueLink_issueId_idx" ON "PageIssueLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "PageIssueLink_pageId_issueId_key" ON "PageIssueLink"("pageId", "issueId");

-- CreateIndex
CREATE INDEX "PageLink_sourcePageId_idx" ON "PageLink"("sourcePageId");

-- CreateIndex
CREATE INDEX "PageLink_targetPageId_idx" ON "PageLink"("targetPageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageLink_sourcePageId_targetPageId_key" ON "PageLink"("sourcePageId", "targetPageId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIssueLink" ADD CONSTRAINT "PageIssueLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageIssueLink" ADD CONSTRAINT "PageIssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageLink" ADD CONSTRAINT "PageLink_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pre-existing, Pages-unrelated naming drift picked up by this migration's
-- diff: the unique index for WorkflowTransition's
-- (projectId, fromStatusId, toStatusId, issueType) constraint was originally
-- created (20260628100000_add_configurable_workflows) by issuing its full,
-- un-truncated intended name and letting Postgres silently byte-truncate it
-- to fit NAMEDATALEN (63 bytes), which chops the trailing "_key" suffix.
-- Prisma's own name-truncation algorithm truncates the middle instead,
-- preserving "_key" — so the two never matched and every future diff run
-- would keep re-proposing this same harmless rename. Fixing it here (a
-- rename only; no data/constraint semantics change) so `prisma migrate diff`
-- reports zero drift going forward.
-- RenameIndex
ALTER INDEX "WorkflowTransition_projectId_fromStatusId_toStatusId_issueType_" RENAME TO "WorkflowTransition_projectId_fromStatusId_toStatusId_issueT_key";
