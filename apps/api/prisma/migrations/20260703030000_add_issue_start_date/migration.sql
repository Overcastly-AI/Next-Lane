-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "startDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Issue_projectId_startDate_idx" ON "Issue"("projectId", "startDate");
