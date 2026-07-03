-- CreateTable
CREATE TABLE "ProjectAgentContext" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAgentContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAgentContext_projectId_key" ON "ProjectAgentContext"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAgentContext_projectId_idx" ON "ProjectAgentContext"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectAgentContext" ADD CONSTRAINT "ProjectAgentContext_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAgentContext" ADD CONSTRAINT "ProjectAgentContext_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
