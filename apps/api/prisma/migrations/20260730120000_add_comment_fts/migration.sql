-- Full-text search generated column + GIN index on Comment (body).
--
-- WHY: comments are where decisions get written down ("Decision: we're going
-- with Stripe") and they were the one memory surface search could not reach —
-- `list_comments` is per-issue only, so "what did we decide about X?" was
-- unanswerable without already knowing the issue. Issue and Page bodies have
-- been indexed since their respective migrations; this closes the gap.
--
-- Mirrors the Page/Issue pattern EXACTLY (see 20260709120000_add_pages_fts and
-- baseline_v2): a Postgres-managed GENERATED ALWAYS AS ... STORED tsvector plus
-- a GIN index, both raw SQL because Prisma can express neither. Comment has a
-- single searchable column, so there is nothing to weight with setweight() —
-- the Page migration only uses it to rank title (A) above content (B).
--
-- Idempotent: drop first so a re-run (or a shadow-db diff) is clean.
ALTER TABLE "Comment"
  DROP COLUMN IF EXISTS "searchVector";

ALTER TABLE "Comment"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("body", ''))
  ) STORED;

-- GIN index for full-text search on the generated column.
CREATE INDEX "Comment_searchVector_idx" ON "Comment" USING GIN ("searchVector");
