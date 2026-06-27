-- AlterTable: add optional dueDate to Issue
ALTER TABLE "Issue" ADD COLUMN "dueDate" TIMESTAMP(3);

-- CreateIndex: cover overdue queries (WHERE dueDate < now() ORDER BY dueDate)
CREATE INDEX "Issue_dueDate_idx" ON "Issue"("dueDate");
