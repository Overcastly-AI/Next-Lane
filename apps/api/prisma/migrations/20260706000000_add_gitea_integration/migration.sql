-- CreateEnum
CREATE TYPE "GiteaLinkKind" AS ENUM ('PR', 'COMMIT', 'BRANCH');

-- CreateTable
CREATE TABLE "GiteaIntegration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "giteaBaseUrl" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiteaIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueGiteaLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" "GiteaLinkKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT NOT NULL,
    "state" TEXT,
    "authorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueGiteaLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiteaIntegration_projectId_key" ON "GiteaIntegration"("projectId");

-- CreateIndex
CREATE INDEX "GiteaIntegration_projectId_idx" ON "GiteaIntegration"("projectId");

-- CreateIndex
CREATE INDEX "IssueGiteaLink_issueId_idx" ON "IssueGiteaLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueGiteaLink_issueId_kind_externalId_key" ON "IssueGiteaLink"("issueId", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "GiteaIntegration" ADD CONSTRAINT "GiteaIntegration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueGiteaLink" ADD CONSTRAINT "IssueGiteaLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
