-- CreateTable
CREATE TABLE "DashboardShareToken" (
    "id" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DashboardShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardShareToken_tokenHash_key" ON "DashboardShareToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardShareToken_dashboardId_idx" ON "DashboardShareToken"("dashboardId");

-- CreateIndex
CREATE INDEX "DashboardShareToken_createdById_idx" ON "DashboardShareToken"("createdById");

-- AddForeignKey
ALTER TABLE "DashboardShareToken" ADD CONSTRAINT "DashboardShareToken_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardShareToken" ADD CONSTRAINT "DashboardShareToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
