-- Kanban sections by field (Swimlanes v2): per-board default swimlane
-- group-by dimension, applied when the board loads without a ?group= override.
ALTER TABLE "Board" ADD COLUMN "defaultGroupBy" TEXT;
