import { withIdempotency, IDEMPOTENCY_WINDOW_MS } from './idempotency.util';
import type { PrismaService } from '../prisma/prisma.service';

function makePrisma() {
  const store = new Map<string, { key: string; userId: string; endpoint: string; responseBody: unknown; createdAt: Date }>();
  const keyOf = (k: { key: string; userId: string; endpoint: string }) =>
    `${k.key}|${k.userId}|${k.endpoint}`;

  const prisma = {
    idempotencyRecord: {
      findUnique: jest.fn(
        ({ where }: { where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } } }) =>
          Promise.resolve(store.get(keyOf(where.key_userId_endpoint)) ?? null),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { key_userId_endpoint: { key: string; userId: string; endpoint: string } };
          create: { key: string; userId: string; endpoint: string; responseBody: unknown };
          update: { responseBody: unknown; createdAt: Date };
        }) => {
          const k = keyOf(where.key_userId_endpoint);
          const row = { ...create, createdAt: new Date() };
          store.set(k, row);
          return Promise.resolve(row);
        },
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { prisma: prisma as unknown as PrismaService, store };
}

describe('withIdempotency', () => {
  it('runs fn and returns its result when no key is provided', async () => {
    const { prisma } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    const result = await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues' }, fn);

    expect(result).toEqual({ id: 'issue-1' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect((prisma as unknown as { idempotencyRecord: { findUnique: jest.Mock } }).idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('runs fn once and stores the response when a key is provided for the first time', async () => {
    const { prisma } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1', title: 'First' });

    const result = await withIdempotency(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'retry-key-1' },
      fn,
    );

    expect(result).toEqual({ id: 'issue-1', title: 'First' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('replays the SAME stored response on a retry with the same key — fn is not called again', async () => {
    const { prisma } = makePrisma();
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ id: 'issue-1', title: 'First' })
      .mockResolvedValueOnce({ id: 'issue-2', title: 'Second (should never be returned)' });

    const first = await withIdempotency<{ id: string; title: string }>(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'retry-key-1' },
      fn,
    );
    const second = await withIdempotency<{ id: string; title: string }>(
      prisma,
      { userId: 'u1', endpoint: 'POST /issues', key: 'retry-key-1' },
      fn,
    );

    expect(first).toEqual({ id: 'issue-1', title: 'First' });
    expect(second).toEqual({ id: 'issue-1', title: 'First' });
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

    await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);
    // Simulate the stored record aging past the window.
    const row = store.get('k|u1|POST /issues')!;
    row.createdAt = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS - 1000);

    const second = await withIdempotency<{ id: string }>(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);

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
    const { prisma } = makePrisma();
    const fn = jest.fn().mockResolvedValue({ id: 'issue-1' });

    await withIdempotency(prisma, { userId: 'u1', endpoint: 'POST /issues', key: 'k' }, fn);

    expect(
      (prisma as unknown as { idempotencyRecord: { deleteMany: jest.Mock } }).idempotencyRecord.deleteMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lt: expect.any(Date) } } }),
    );
  });
});
