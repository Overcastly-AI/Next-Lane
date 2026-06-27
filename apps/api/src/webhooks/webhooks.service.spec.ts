import { createHmac } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Role, WebhookEventTypes } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { WebhooksService, signPayload } from './webhooks.service';
import type { PrismaService } from '../prisma/prisma.service';

const PROJECT = 'project-1';
const SUB_ID = 'sub-1';
const SECRET = 'super-secret-value';

function makePrisma() {
  return {
    webhookSubscription: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

const subRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: SUB_ID,
  projectId: PROJECT,
  url: 'https://example.test/hook',
  secret: SECRET,
  events: [] as string[],
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

// Wait for fire-and-forget dispatch microtasks to flush.
const flush = () => new Promise((r) => setImmediate(r));

describe('signPayload', () => {
  it('computes a deterministic sha256 HMAC of the raw body', () => {
    const body = JSON.stringify({ a: 1, b: 'two' });
    const expected =
      'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
    expect(signPayload(SECRET, body)).toBe(expected);
    // Stable across calls.
    expect(signPayload(SECRET, body)).toBe(signPayload(SECRET, body));
  });

  it('changes when the secret changes', () => {
    const body = '{"x":1}';
    expect(signPayload('secret-a', body)).not.toBe(
      signPayload('secret-b', body),
    );
  });
});

describe('WebhooksService scoping', () => {
  let prisma: MockPrisma;
  let service: WebhooksService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WebhooksService(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('requires ADMIN role to list subscriptions', async () => {
    const spy = jest
      .spyOn(membership, 'assertProjectRole')
      .mockRejectedValue(new ForbiddenException());

    await expect(service.findAll('user-1', PROJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(spy).toHaveBeenCalledWith(prisma, 'user-1', PROJECT, Role.ADMIN);
  });

  it('requires ADMIN role to create a subscription', async () => {
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockRejectedValue(new ForbiddenException());

    await expect(
      service.create('user-1', PROJECT, { url: 'https://example.test/h' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it('does not return the secret in the create response', async () => {
    jest
      .spyOn(membership, 'assertProjectRole')
      .mockResolvedValue({} as never);
    prisma.webhookSubscription.create.mockResolvedValue(subRow());

    const dto = await service.create('user-1', PROJECT, {
      url: 'https://example.test/h',
      secret: SECRET,
    });
    expect(dto).not.toHaveProperty('secret');
    expect(dto.url).toBe('https://example.test/hook');
  });

  it('enforces ADMIN on the owning project when updating by id', async () => {
    prisma.webhookSubscription.findUnique.mockResolvedValue(subRow());
    const spy = jest
      .spyOn(membership, 'assertProjectRole')
      .mockRejectedValue(new ForbiddenException());

    await expect(
      service.update('intruder', SUB_ID, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Authorization is scoped to the subscription's own project.
    expect(spy).toHaveBeenCalledWith(prisma, 'intruder', PROJECT, Role.ADMIN);
  });
});

describe('WebhooksService dispatch / delivery', () => {
  let prisma: MockPrisma;
  let service: WebhooksService;
  const realFetch = global.fetch;

  beforeEach(() => {
    prisma = makePrisma();
    service = new WebhooksService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('records a success delivery row and signs the request (no real network)', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow()]);
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    // The outbound call was mocked — never a real external request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/hook');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-NextLane-Event']).toBe(WebhookEventTypes.IssueCreated);
    expect(headers['X-NextLane-Signature']).toBe(
      signPayload(SECRET, init.body as string),
    );

    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      subscriptionId: SUB_ID,
      event: WebhookEventTypes.IssueCreated,
      status: 'success',
      responseStatus: 200,
    });
  });

  it('records a failed delivery row when the receiver errors', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow()]);
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row.status).toBe('failed');
    expect(row.error).toContain('connection refused');
  });

  it('only delivers to subscriptions whose events match', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow({ id: 'a', events: ['issue.created'] }),
      subRow({ id: 'b', events: ['sprint.started'] }),
      subRow({ id: 'c', events: [] }), // empty = all
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    // 'a' (subscribed to issue.created) and 'c' (all) match; 'b' does not.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
  });

  it('skips dispatch entirely when no active subscriptions match', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow({ events: ['sprint.completed'] }),
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });
});
