-- AlterTable: GithubIntegration gains the (opt-in, off by default) auto-
-- transition-on-merge toggle + its target status.
ALTER TABLE "GithubIntegration"
  ADD COLUMN "autoTransitionOnMerge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoTransitionStatusId" TEXT;

-- AlterTable: GitlabIntegration mirrors GithubIntegration exactly.
ALTER TABLE "GitlabIntegration"
  ADD COLUMN "autoTransitionOnMerge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoTransitionStatusId" TEXT;

-- CreateIndex
CREATE INDEX "GithubIntegration_autoTransitionStatusId_idx" ON "GithubIntegration"("autoTransitionStatusId");

-- CreateIndex
CREATE INDEX "GitlabIntegration_autoTransitionStatusId_idx" ON "GitlabIntegration"("autoTransitionStatusId");

-- AddForeignKey: SetNull so deleting the target status doesn't corrupt the
-- integration row — the toggle just stops firing until re-configured.
ALTER TABLE "GithubIntegration" ADD CONSTRAINT "GithubIntegration_autoTransitionStatusId_fkey" FOREIGN KEY ("autoTransitionStatusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitlabIntegration" ADD CONSTRAINT "GitlabIntegration_autoTransitionStatusId_fkey" FOREIGN KEY ("autoTransitionStatusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;
