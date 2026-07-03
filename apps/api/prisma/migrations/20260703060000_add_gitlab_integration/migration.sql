-- CreateEnum
CREATE TYPE "GitlabLinkKind" AS ENUM ('MR', 'COMMIT', 'BRANCH');

-- CreateTable
CREATE TABLE "GitlabIntegration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "gitlabBaseUrl" TEXT NOT NULL DEFAULT 'https://gitlab.com',
    "projectPath" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitlabIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueGitlabLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "GitlabLinkKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "state" TEXT,
    "authorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueGitlabLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitlabIntegration_projectId_key" ON "GitlabIntegration"("projectId");

-- CreateIndex
CREATE INDEX "GitlabIntegration_projectId_idx" ON "GitlabIntegration"("projectId");

-- CreateIndex
CREATE INDEX "IssueGitlabLink_issueId_idx" ON "IssueGitlabLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueGitlabLink_issueId_kind_externalId_key" ON "IssueGitlabLink"("issueId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "GitlabIntegration" ADD CONSTRAINT "GitlabIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueGitlabLink" ADD CONSTRAINT "IssueGitlabLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
