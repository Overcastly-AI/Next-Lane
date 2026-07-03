import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotency window: a replayed key returns the original response for this
 * long after it was first recorded. Matches the acceptance criterion
 * ("~24h window") from the Agent Experience Round 2 field report — an agent
 * retrying `create_issue`/`add_comment` after a network blip within a
 * session should never create a duplicate.
 */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Run `fn` at most once per (endpoint, userId, key) within the idempotency
 * window. A retried call with the SAME key replays the ORIGINAL stored
 * response (deserialized exactly as first recorded) instead of re-running
 * `fn` — this is what makes `create_issue`/`add_comment` safe to retry after
 * a network blip without creating duplicate tickets/comments.
 *
 * `key` is optional: when omitted (the overwhelming majority of calls today,
 * and every call site that predates this feature), `fn` always runs with no
 * idempotency bookkeeping at all — completely unaffected.
 *
 * Concurrency note: this uses a read-then-write pattern (check for an
 * existing record, run `fn` if absent, then upsert the result), not a
 * claim-a-lock-first pattern. It is correct for the reported scenario
 * (sequential retries — a client waits for a response/timeout before
 * retrying with the same key) but does not guarantee exactly-once semantics
 * for two truly concurrent requests racing with the same key; that would
 * require a claim-first design with the loser polling for the winner's
 * result, which is more machinery than this field report's failure mode
 * (sequential retry after a network blip) needs.
 *
 * Cleanup is opportunistic: every successful write also fires a
 * non-blocking `deleteMany` of expired rows (best-effort, errors swallowed)
 * rather than a scheduled job — proportionate for a table this small and
 * short-lived on a self-hosted single-instance deployment.
 */
export async function withIdempotency<T>(
  prisma: PrismaService,
  params: { userId: string; endpoint: string; key?: string | null },
  fn: () => Promise<T>,
): Promise<T> {
  const key = params.key?.trim();
  if (!key) return fn();

  const existing = await prisma.idempotencyRecord.findUnique({
    where: {
      key_userId_endpoint: { key, userId: params.userId, endpoint: params.endpoint },
    },
  });
  if (existing && Date.now() - existing.createdAt.getTime() < IDEMPOTENCY_WINDOW_MS) {
    return existing.responseBody as T;
  }

  const result = await fn();

  // Upsert: a replay after the window (existing but expired) naturally
  // overwrites the stale row with the fresh response + a reset createdAt.
  await prisma.idempotencyRecord.upsert({
    where: {
      key_userId_endpoint: { key, userId: params.userId, endpoint: params.endpoint },
    },
    create: {
      key,
      userId: params.userId,
      endpoint: params.endpoint,
      responseBody: result as unknown as Prisma.InputJsonValue,
    },
    update: {
      responseBody: result as unknown as Prisma.InputJsonValue,
      createdAt: new Date(),
    },
  });

  void prisma.idempotencyRecord
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) } } })
    .catch(() => {
      // Best-effort cleanup — never let it affect the caller's response.
    });

  return result;
}
