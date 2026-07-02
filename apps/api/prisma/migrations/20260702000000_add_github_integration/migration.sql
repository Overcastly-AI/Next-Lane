-- CreateEnum
CREATE TYPE "GithubLinkKind" AS ENUM ('PR', 'COMMIT', 'BRANCH');

-- CreateTable
CREATE TABLE "GithubIntegration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueGithubLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "GithubLinkKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "state" TEXT,
    "authorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueGithubLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GithubIntegration_projectId_key" ON "GithubIntegration"("projectId");

-- CreateIndex
CREATE INDEX "GithubIntegration_projectId_idx" ON "GithubIntegration"("projectId");

-- CreateIndex
CREATE INDEX "IssueGithubLink_issueId_idx" ON "IssueGithubLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueGithubLink_issueId_kind_externalId_key" ON "IssueGithubLink"("issueId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "GithubIntegration" ADD CONSTRAINT "GithubIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueGithubLink" ADD CONSTRAINT "IssueGithubLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
