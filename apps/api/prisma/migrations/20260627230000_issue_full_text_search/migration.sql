-- Full-text search for the Issue table.
-- Prisma cannot express generated tsvector columns directly, so this migration
-- uses raw SQL to add a STORED generated column and a GIN index over it.
-- The column is regenerated automatically by Postgres whenever title or description change.
-- websearch_to_tsquery / to_tsquery queries hit the GIN index without any application-level
-- tsvector maintenance.
--
-- NOTE: The column is declared as Unsupported("tsvector") in schema.prisma so that
-- prisma validate / prisma generate do not error, but Prisma will never attempt to
-- read or write it directly — all FTS queries go through $queryRaw.

ALTER TABLE "Issue"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title, '') || ' ' || coalesce(description, '')
      )
    ) STORED;

-- GIN index enables sub-millisecond @@ queries even on millions of rows.
CREATE INDEX IF NOT EXISTS "Issue_searchVector_idx"
  ON "Issue" USING GIN ("searchVector");
