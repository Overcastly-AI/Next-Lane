import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
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

/** How often a concurrent duplicate polls for the in-flight winner's result. */
export const IDEMPOTENCY_POLL_INTERVAL_MS = 250;

/**
 * How long a concurrent duplicate waits for the in-flight winner before
 * giving up with 409. Longer than any healthy create; a request still
 * pending past this is either hung or was killed without releasing.
 */
export const IDEMPOTENCY_POLL_TIMEOUT_MS = 8_000;

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * Stable hash of the logical request payload. Stored on first use of a key
 * and compared on replay: the same key with a DIFFERENT payload is a caller
 * bug (a reused key), and silently replaying the first response would hand
 * back a 200 for a write that never happened — so it 409s instead.
 */
export function idempotencyFingerprint(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload ?? null))
    .digest('hex');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` at most once per (endpoint, userId, key) within the idempotency
 * window. A retried call with the SAME key replays the ORIGINAL stored
 * response instead of re-running `fn` — this is what makes
 * `create_issue`/`add_comment` safe to retry after a network blip without
 * creating duplicate tickets/comments.
 *
 * `key` is optional: when omitted (every call site that predates this
 * feature), `fn` always runs with no idempotency bookkeeping at all.
 *
 * Concurrency: claim-first. The caller INSERTS a pending row (responseBody
 * NULL) before running `fn`; the unique constraint on (key, userId,
 * endpoint) elects exactly one executor, and a concurrent duplicate —
 * including the classic client-timeout-while-the-server-is-still-working
 * retry — polls for the winner's stored response instead of running `fn` a
 * second time. If the executor's `fn` throws, the claim is RELEASED (row
 * deleted) so a later retry can attempt the operation again; nothing is
 * recorded for a failed attempt.
 *
 * Payload safety: `requestFingerprint` (hashed) is stored with the claim.
 * A replay whose payload hash differs from the stored one is rejected with
 * 409 rather than silently returning the first request's response — a
 * reused key with a different body is always a caller bug.
 *
 * Cleanup is opportunistic: every successful write also fires a
 * non-blocking `deleteMany` of expired rows (best-effort, errors swallowed)
 * rather than a scheduled job — proportionate for a table this small and
 * short-lived on a self-hosted single-instance deployment.
 */
export async function withIdempotency<T>(
  prisma: PrismaService,
  params: {
    userId: string;
    endpoint: string;
    key?: string | null;
    /** Logical request payload; hashed and compared on replay. */
    requestFingerprint?: unknown;
    /** Test seams — production call sites never set these. */
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const key = params.key?.trim();
  if (!key) return fn();

  const scope = { key, userId: params.userId, endpoint: params.endpoint };
  const where = { key_userId_endpoint: scope };
  const requestHash = idempotencyFingerprint(params.requestFingerprint);
  const pollIntervalMs = params.pollIntervalMs ?? IDEMPOTENCY_POLL_INTERVAL_MS;
  const pollTimeoutMs = params.pollTimeoutMs ?? IDEMPOTENCY_POLL_TIMEOUT_MS;

  // Claim phase: exactly one concurrent caller wins the insert and becomes
  // the executor; everyone else resolves against the winner's row.
  claim: for (;;) {
    try {
      await prisma.idempotencyRecord.create({
        data: { ...scope, requestHash },
      });
      break; // claimed — we are the executor
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }

    const existing = await prisma.idempotencyRecord.findUnique({ where });
    // Released between our failed insert and this read — try to claim again.
    if (!existing) continue;

    if (Date.now() - existing.createdAt.getTime() >= IDEMPOTENCY_WINDOW_MS) {
      // Expired row: delete it (by id, so we never race a fresh claimant)
      // and re-claim.
      await prisma.idempotencyRecord.deleteMany({
        where: { id: existing.id },
      });
      continue;
    }

    if (existing.requestHash !== '' && existing.requestHash !== requestHash) {
      throw new ConflictException(
        'This idempotencyKey was already used with a different request payload. Use a new key for each distinct request.',
      );
    }

    if (existing.responseBody !== null) {
      return existing.responseBody as T;
    }

    // Pending: the original request is still executing (the classic
    // client-timeout retry). Wait briefly for its result.
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const row = await prisma.idempotencyRecord.findUnique({ where });
      if (!row) continue claim; // executor failed and released — re-claim
      if (row.responseBody !== null) return row.responseBody as T;
    }
    throw new ConflictException(
      'A request with this idempotencyKey is still in progress. Retry shortly.',
    );
  }

  // Executor phase: run the mutation, then publish the response on our
  // claim. A failure RELEASES the claim — recording nothing — so the
  // caller's retry gets a genuine second attempt instead of a replay of an
  // error, and never a duplicate (the mutation only commits inside fn).
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await prisma.idempotencyRecord
      .deleteMany({ where: scope })
      .catch(() => {
        // Best-effort release; an orphaned pending row expires with the window.
      });
    throw e;
  }

  await prisma.idempotencyRecord.update({
    where,
    data: { responseBody: result as unknown as Prisma.InputJsonValue },
  });

  void prisma.idempotencyRecord
    .deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) } },
    })
    .catch(() => {
      // Best-effort cleanup — never let it affect the caller's response.
    });

  return result;
}
