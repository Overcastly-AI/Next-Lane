-- Board: a project can have many boards, each a view of the project's issues.
-- `type` controls issue scoping (KANBAN = continuous flow; SCRUM = active-sprint
-- focus). Boards share the project's statuses as columns. `filterQuery` (NLQL)
-- and `colorRules` (JSONB) are reserved for later slices and stay null for now.

-- CreateEnum
CREATE TYPE "BoardType" AS ENUM ('KANBAN', 'SCRUM');

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BoardType" NOT NULL DEFAULT 'KANBAN',
    "filterQuery" TEXT,
    "colorRules" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Board_projectId_idx" ON "Board"("projectId");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing project one default Kanban board so the board
-- view keeps working unchanged. KANBAN preserves the prior scope (issues with
-- no sprint OR in the active sprint).
INSERT INTO "Board" ("id", "projectId", "name", "type", "order", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Main Board', 'KANBAN', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Project";
