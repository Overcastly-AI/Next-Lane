-- Claim-first idempotency: the row is inserted BEFORE the mutation runs
-- (responseBody NULL = in flight), and the request payload hash is stored
-- so a reused key with a different body can be rejected instead of
-- silently replaying the first response.
ALTER TABLE "IdempotencyRecord" ALTER COLUMN "responseBody" DROP NOT NULL;
ALTER TABLE "IdempotencyRecord" ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '';
