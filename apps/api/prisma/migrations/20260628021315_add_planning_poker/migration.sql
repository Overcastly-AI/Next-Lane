-- AddEnum: PokerState
CREATE TYPE "PokerState" AS ENUM ('VOTING', 'REVEALED', 'CLOSED');

-- CreateTable: PokerSession
CREATE TABLE "PokerSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "name" TEXT,
    "state" "PokerState" NOT NULL DEFAULT 'VOTING',
    "activeItemId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PokerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PokerItem
CREATE TABLE "PokerItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "finalEstimate" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PokerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PokerVote
CREATE TABLE "PokerVote" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PokerVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PokerSession_projectId_idx" ON "PokerSession"("projectId");

-- CreateIndex
CREATE INDEX "PokerSession_sprintId_idx" ON "PokerSession"("sprintId");

-- CreateIndex
CREATE INDEX "PokerItem_sessionId_idx" ON "PokerItem"("sessionId");

-- CreateIndex: unique one item per issue per session
CREATE UNIQUE INDEX "PokerItem_sessionId_issueId_key" ON "PokerItem"("sessionId", "issueId");

-- CreateIndex
CREATE INDEX "PokerVote_itemId_idx" ON "PokerVote"("itemId");

-- CreateIndex: unique one vote per user per item
CREATE UNIQUE INDEX "PokerVote_itemId_userId_key" ON "PokerVote"("itemId", "userId");

-- AddForeignKey: PokerSession → Project (Cascade)
ALTER TABLE "PokerSession" ADD CONSTRAINT "PokerSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PokerSession → Sprint (SetNull)
ALTER TABLE "PokerSession" ADD CONSTRAINT "PokerSession_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PokerSession → User (SetNull)
ALTER TABLE "PokerSession" ADD CONSTRAINT "PokerSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PokerItem → PokerSession (Cascade)
ALTER TABLE "PokerItem" ADD CONSTRAINT "PokerItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PokerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PokerItem → Issue (Cascade)
ALTER TABLE "PokerItem" ADD CONSTRAINT "PokerItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PokerVote → PokerItem (Cascade)
ALTER TABLE "PokerVote" ADD CONSTRAINT "PokerVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PokerItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PokerVote → User (Cascade)
ALTER TABLE "PokerVote" ADD CONSTRAINT "PokerVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
