import { createHmac } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Role, WebhookEventTypes } from '@next-lane/shared';
import * as membership from '../common/membership.util';
import { WebhooksService, signPayload, isBlockedIp } from './webhooks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const mockAudit: Pick<AuditService, 'record'> = { record: jest.fn() };

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

// These tests exercise the in-process (no-Redis) delivery path. Force REDIS_URL
// unset so the WebhooksService constructor never spins up a real BullMQ queue —
// keeps the suite hermetic regardless of ambient env or sibling-suite leakage.
let savedRedisUrl: string | undefined;
beforeEach(() => {
  savedRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
});
afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedisUrl;
});

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
    service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
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
    service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    // Mock DNS so delivery tests don't need a real network: "example.test"
    // resolves to a public IP address (not in any blocked range).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('records a success delivery row and signs the request (no real network)', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow()]);
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') } as unknown as Response);
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
      .mockResolvedValue({ ok: true, status: 204, text: () => Promise.resolve('') } as unknown as Response);
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

// ---- isBlockedIp unit tests ------------------------------------------------

describe('isBlockedIp', () => {
  describe('IPv4 blocked ranges', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.1.2.3', 'loopback /8'],
      ['169.254.169.254', 'AWS link-local metadata endpoint'],
      ['169.254.0.1', 'link-local /16'],
      ['10.0.0.1', 'private class A /8'],
      ['10.255.255.255', 'private class A edge'],
      ['172.16.0.1', 'private class B /12 lower'],
      ['172.31.255.255', 'private class B /12 upper'],
      ['192.168.0.1', 'private class C /16'],
      ['192.168.255.255', 'private class C edge'],
      ['0.0.0.0', 'this-network /8'],
      ['0.255.255.255', 'this-network /8 edge'],
    ])('blocks %s (%s)', (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each([
      ['8.8.8.8', 'public Google DNS'],
      ['1.1.1.1', 'public Cloudflare DNS'],
      ['172.15.255.255', 'just below private class B /12'],
      ['172.32.0.0', 'just above private class B /12'],
      ['192.169.0.0', 'just above private class C /16'],
    ])('allows %s (%s)', (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  });

  describe('IPv6 blocked ranges', () => {
    it.each([
      ['::1', 'loopback'],
      ['fe80::1', 'link-local'],
      ['fe80::dead:beef', 'link-local with suffix'],
      ['fc00::1', 'unique-local fc00::/7 lower'],
      ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'unique-local fc00::/7 upper'],
    ])('blocks %s (%s)', (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each([
      ['2001:4860:4860::8888', 'public Google DNS v6'],
      ['2606:4700:4700::1111', 'public Cloudflare DNS v6'],
    ])('allows %s (%s)', (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  });
});

// ---- SSRF delivery guard integration tests ---------------------------------

describe('WebhooksService SSRF delivery guard', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: WebhooksService;
  const realFetch = global.fetch;
  const realEnv = process.env.WEBHOOK_ALLOW_PRIVATE;

  const subRow = (url: string) => ({
    id: SUB_ID,
    projectId: PROJECT,
    url,
    secret: SECRET,
    events: [] as string[],
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  beforeEach(() => {
    prisma = makePrisma();
    service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (realEnv === undefined) {
      delete process.env.WEBHOOK_ALLOW_PRIVATE;
    } else {
      process.env.WEBHOOK_ALLOW_PRIVATE = realEnv;
    }
    jest.restoreAllMocks();
  });

  it('blocks delivery to 127.0.0.1 (loopback) and records a failed row without calling fetch', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow('http://127.0.0.1/hook')]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    // fetch must never be called for a blocked target
    expect(fetchMock).not.toHaveBeenCalled();

    // A failed delivery row should still be recorded
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/SSRF blocked/i);
  });

  it('blocks delivery to 169.254.169.254 (link-local / cloud metadata) without calling fetch', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow('http://169.254.169.254/latest/meta-data/'),
    ]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/SSRF blocked/i);
  });

  it('allows delivery to a public host when WEBHOOK_ALLOW_PRIVATE is unset', async () => {
    // For this test we mock the DNS lookup to return a public IP so we don't
    // need real network access.
    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow('https://example.test/hook'),
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    // To avoid real DNS in CI we spy on the dns module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row.status).toBe('success');
  });

  it('bypasses SSRF guard when WEBHOOK_ALLOW_PRIVATE=true', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';

    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow('http://192.168.1.100/hook'),
    ]);
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i1' });
    await flush();

    // When the flag is set, fetch should be called even for a private IP
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const row = prisma.webhookDelivery.create.mock.calls[0][0].data;
    expect(row.status).toBe('success');
  });
});
