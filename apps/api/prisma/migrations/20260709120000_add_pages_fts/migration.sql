-- Full-text search generated column + GIN index on Page (title + content).
-- Mirrors Issue.searchVector (see baseline_v2). Prisma cannot express
-- GENERATED ALWAYS AS ... STORED or GIN indexes natively, so this is raw SQL.
-- Idempotent: drop first so a re-run (or a shadow-db diff) is clean.
ALTER TABLE "Page"
  DROP COLUMN IF EXISTS "searchVector";

ALTER TABLE "Page"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'B')
  ) STORED;

-- GIN index for full-text search on the generated column.
CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
