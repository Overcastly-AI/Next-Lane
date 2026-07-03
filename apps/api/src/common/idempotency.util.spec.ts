import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withIdempotency, IDEMPOTENCY_WINDOW_MS } from './idempotency.util';
import type { PrismaService } from '../prisma/prisma.service';

interface Row {
  id: string;
  key: string;
  userId: string;
  endpoint: string;
  requestHash: string;
  responseBody: unknown | null;
  createdAt: Date;
}

/**
 * In-memory mock of the claim-first flow: `create` enforces the unique
 * constraint by throwing a real P2002, mirroring Postgres.
 */
function makePrisma() {
  const store = new Map<string, Row>();
  let seq = 0;
  const keyOf = (k: { key: string; userId: string; endpoint: string }) =>
    `${k.key}|${k.userId}|${k.endpoint}`;

  const idempotencyRecord = {
    create: jest.fn(({ data }: { data: Omit<Row, 'id' | 'responseBody' | 'createdAt'> }) => {
      const k = keyOf(data);
      if (store.has(k)) {
        return Promise.reject(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );
      }
      const row: Row = { id: `row-${++seq}`, ...data, responseBody: null, createdAt: new Date() };
      store.set(k, row);
      return Promise.resolve(row);
    }),
    findUnique: jest.fn(
      ({ where }: { where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } } }) =>
        Promise.resolve(store.get(keyOf(where.key_userId_endpoint)) ?? null),
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } };
        data: { responseBody: unknown };
      }) => {
        const row = store.get(keyOf(where.key_userId_endpoint));
        if (!row) return Promise.reject(new Error('Record not found'));
        row.responseBody = data.responseBody;
        return Promise.resolve(row);
      },
    ),
    deleteMany: jest.fn(
      ({ where }: { where: { id?: string; key?: string; userId?: string; endpoint?: string; createdAt?: { lt: Date } } }) => {
        let count = 0;
        for (const [k, row] of store) {
          const match =
            (where.id === undefined || row.id === where.id) &&
            (where.key === undefined || row.key === where.key) &&
            (where.userId === undefined || row.userId === where.userId) &&
            (where.endpoint === undefined || row.endpoint === where.endpoint) &&
            (where.createdAt === undefined || row.createdAt < where.createdAt.lt);
          if (match) {
            store.delete(k);
            count++;
          }
        }
        return Promise.resolve({ count });
      },
    ),
  };
  return { prisma: { idempotencyRecord } as unknown as PrismaService, store, idempotencyRecord };
}

/** Fast poll settings so concurrency tests don't sleep for real. */
const FAST = { pollIntervalMs: 5, pollTimeoutMs: 250 };

describe('withIdempotency', () => {
  it('runs fn and returns its result when no key is provided', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    const result = await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues' }, fn);

    expect(result).toEqual({ id: 'issue-1' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it('runs fn once and publishes the response on the claim for a first-time key', async () => {
    const { prisma, store } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1', title: 'First' });

    const result = await withIdempotency(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'retry-key-1' },
      fn,
    );

    expect(result).toEqual({ id: 'issue-1', title: 'First' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.get('retry-key-1|u1|POST /issues')?.responseBody).toEqual({
      id: 'issue-1',
      title: 'First',
    });
  });

  it('replays the SAME stored response on a retry with the same key — fn is not called again', async () => {
    const { prisma } = makePrisma();
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ id: 'issue-1', title: 'First' })
      .mockResolvedValueOnce({ id: 'issue-2', title: 'Second (should never be returned)' });
    const params = { userId: 'u1', endpoint: 'POST /issues', key: 'retry-key-1' };

    const first = await withIdempotency<{ id: string; title: string }>(prisma, params, fn);
    const second = await withIdempotency<{ id: string; title: string }>(prisma, params, fn);

    expect(second.id).toBe(first.id); // same issue id — no duplicate created
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('scopes the key by userId — a different user with the same key runs fn independently', async () => {
    const { prisma } = makePrisma();
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ id: 'issue-1' })
      .mockResolvedValueOnce({ id: 'issue-2' });

    const a = await withIdempotency<{ id: string }>(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);
    const b = await withIdempotency<{ id: string }>(prisma, { userId: 'u2', endpoint: 'POST /issues', key: 'k' }, fn);

    expect(a.id).toBe('issue-1');
    expect(b.id).toBe('issue-2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('scopes the key by endpoint — the same user+key on a different endpoint runs fn independently', async () => {
    const { prisma } = makePrisma();
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ id: 'issue-1' })
      .mockResolvedValueOnce({ id: 'comment-1' });

    const a = await withIdempotency<{ id: string }>(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);
    const b = await withIdempotency<{ id: string }>(prisma, { userId: 'u1', endpoint: 'POST comments', key: 'k' }, fn);

    expect(a.id).toBe('issue-1');
    expect(b.id).toBe('comment-1');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('re-runs fn once the window has expired', async () => {
    const { prisma, store } = makePrisma();
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ id: 'issue-1' })
      .mockResolvedValueOnce({ id: 'issue-2' });
    const params = { userId: 'u1', endpoint: 'POST /issues', key: 'k' };

    await withIdempotency(prisma, params, fn);
    // Simulate the stored record aging past the window.
    store.get('k|u1|POST /issues')!.createdAt = new Date(
      Date.now() - IDEMPOTENCY_WINDOW_MS - 1000,
    );

    const second = await withIdempotency<{ id: string }>(prisma, params, fn);

    expect(second.id).toBe('issue-2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('treats a blank/whitespace-only key the same as no key', async () => {
    const { prisma } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues', key: '   ' }, fn);
    await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues', key: '   ' }, fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fires an opportunistic cleanup of expired rows after a fresh write (non-blocking)', async () => {
    const { prisma, idempotencyRecord } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);

    expect(idempotencyRecord.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lt: expect.any(Date) } } }),
    );
  });

  // ——— Review findings (2026-07-03): claim-first concurrency semantics ———

  it('CONCURRENT duplicate: runs fn exactly once and hands the winner result to the loser (client-timeout retry)', async () => {
    const { prisma } = makePrisma();
    let releaseFirst!: (v: { id: string }) => void;
    const fn = jest
      .fn()
      // First call hangs until we release it — simulating a slow request the
      // client has already given up on and retried.
      .mockImplementationOnce(() => new Promise<{ id: string }>((r) => (releaseFirst = r)))
      .mockResolvedValueOnce({ id: 'DUPLICATE-should-never-exist' });
    const params = { userId: 'u1', endpoint: 'POST /issues', key: 'k', ...FAST };

    const first = withIdempotency<{ id: string }>(prisma, params, fn);
    // Give the first call a tick to claim.
    await new Promise((r) => setTimeout(r, 10));
    const second = withIdempotency<{ id: string }>(prisma, params, fn);
    await new Promise((r) => setTimeout(r, 20));
    releaseFirst({ id: 'issue-1' });

    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe('issue-1');
    expect(b.id).toBe('issue-1'); // loser replays winner's result
    expect(fn).toHaveBeenCalledTimes(1); // the mutation ran exactly once
  });

  it('CONCURRENT duplicate: 409s (retryable) if the winner is still executing past the poll timeout', async () => {
    const { prisma } = makePrisma();
    const fn = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const params = { userId: 'u1', endpoint: 'POST /issues', key: 'k', ...FAST };

    void withIdempotency(prisma, params, fn).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    await expect(withIdempotency(prisma, params, fn)).rejects.toBeInstanceOf(ConflictException);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('FAILED first attempt releases the claim — the retry genuinely re-runs fn', async () => {
    const { prisma, store } = makePrisma();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('db exploded mid-create'))
      .mockResolvedValueOnce({ id: 'issue-1' });
    const params = { userId: 'u1', endpoint: 'POST /issues', key: 'k' };

    await expect(withIdempotency(prisma, params, fn)).rejects.toThrow('db exploded mid-create');
    // Claim released — nothing recorded for the failed attempt.
    expect(store.has('k|u1|POST /issues')).toBe(false);

    const retry = await withIdempotency<{ id: string }>(prisma, params, fn);
    expect(retry.id).toBe('issue-1');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('REUSED key with a DIFFERENT payload 409s instead of silently replaying the first response', async () => {
    const { prisma } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    await withIdempotency(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'k', requestFingerprint: { title: 'A' } },
      fn,
    );

    await expect(
      withIdempotency(
        prisma,
        { userId: 'u1', endpoint: 'POST /issues', key: 'k', requestFingerprint: { title: 'B — different request!' } },
        fn,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fn).toHaveBeenCalledTimes(1); // no write happened for the mismatch

    // Same key + SAME payload still replays fine.
    const replay = await withIdempotency<{ id: string }>(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'k', requestFingerprint: { title: 'A' } },
      fn,
    );
    expect(replay.id).toBe('issue-1');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
