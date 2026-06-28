-- Migration: add_personal_boards
-- Adds PersonalColumn and PersonalCard for the private per-user kanban board.
-- Cards can optionally be promoted to a real Issue (promotedIssueId → Issue, SetNull).

-- CreateTable
CREATE TABLE "PersonalColumn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "rank" TEXT NOT NULL,
    "promotedIssueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalColumn_userId_idx" ON "PersonalColumn"("userId");

-- CreateIndex
CREATE INDEX "PersonalCard_userId_idx" ON "PersonalCard"("userId");

-- CreateIndex
CREATE INDEX "PersonalCard_columnId_rank_idx" ON "PersonalCard"("columnId", "rank");

-- AddForeignKey
ALTER TABLE "PersonalColumn" ADD CONSTRAINT "PersonalColumn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalCard" ADD CONSTRAINT "PersonalCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalCard" ADD CONSTRAINT "PersonalCard_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "PersonalColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalCard" ADD CONSTRAINT "PersonalCard_promotedIssueId_fkey" FOREIGN KEY ("promotedIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
