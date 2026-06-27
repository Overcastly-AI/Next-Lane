/**
 * Tests for the Redis/BullMQ delivery path and the shared executeDelivery function.
 *
 * Covers:
 *   1. WebhooksService.dispatch() enqueues correct job shape when REDIS_URL is set.
 *   2. executeDelivery() applies SSRF guard (blocks private IPs, records result).
 *   3. executeDelivery() computes correct HMAC signature on outbound requests.
 *   4. SSRF guard still blocks 127.0.0.1 when WEBHOOK_ALLOW_PRIVATE is unset.
 *   5. SSRF guard is bypassed when WEBHOOK_ALLOW_PRIVATE=true.
 */
import { WebhookEventTypes } from '@next-lane/shared';
import {
  WebhooksService,
  executeDelivery,
  signPayload,
  WEBHOOK_QUEUE_NAME,
} from './webhooks.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const mockAudit: Pick<AuditService, 'record'> = { record: jest.fn() };

// ---- helpers ---------------------------------------------------------------

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

const PROJECT = 'project-redis';
const SUB_ID = 'sub-redis';
const SECRET = 'redis-test-secret';
const HOOK_URL = 'https://hooks.example.test/recv';

function subRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUB_ID,
    projectId: PROJECT,
    url: HOOK_URL,
    secret: SECRET,
    events: [] as string[],
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// ---- BullMQ queue mock -----------------------------------------------------

// Hoist the add mock so we can assert on it.
const queueAddMock = jest.fn().mockResolvedValue({ id: 'job-1' });

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: queueAddMock,
    })),
    Worker: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
    })),
  };
});

// ---- Tests: producer enqueues correct job shape ----------------------------

describe('WebhooksService (Redis mode) — enqueue on dispatch', () => {
  const realEnv = process.env.REDIS_URL;

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    queueAddMock.mockClear();
  });

  afterEach(() => {
    if (realEnv === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = realEnv;
    jest.restoreAllMocks();
  });

  it('creates a BullMQ Queue when REDIS_URL is set', () => {
    const { Queue } = jest.requireMock<typeof import('bullmq')>('bullmq');
    const prisma = makePrisma();
    new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    expect(Queue).toHaveBeenCalledWith(
      WEBHOOK_QUEUE_NAME,
      expect.objectContaining({ connection: expect.objectContaining({ url: 'redis://127.0.0.1:6379' }) }),
    );
  });

  it('enqueues one job per matching subscription with correct job shape', async () => {
    const prisma = makePrisma();
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow()]);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    const service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i-1' });
    await flush();

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = queueAddMock.mock.calls[0] as [string, unknown];
    expect(jobName).toBe(WebhookEventTypes.IssueCreated);

    const data = jobData as { sub: { id: string; url: string }; secret: string; payload: { event: string } };
    expect(data.sub.id).toBe(SUB_ID);
    expect(data.sub.url).toBe(HOOK_URL);
    expect(data.secret).toBe(SECRET);
    expect(data.payload.event).toBe(WebhookEventTypes.IssueCreated);
  });

  it('does NOT call fetch directly in Redis mode (delivery is delegated to BullMQ)', async () => {
    const prisma = makePrisma();
    prisma.webhookSubscription.findMany.mockResolvedValue([subRow()]);

    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i-2' });
    await flush();

    // In Redis mode, dispatch only enqueues — never calls fetch inline.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enqueues separate jobs for each matching subscription', async () => {
    const prisma = makePrisma();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      subRow({ id: 'sub-a', events: [] }),
      subRow({ id: 'sub-b', events: ['issue.created'] }),
      subRow({ id: 'sub-c', events: ['sprint.started'] }), // does not match
    ]);

    const service = new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    service.dispatch(PROJECT, WebhookEventTypes.IssueCreated, { id: 'i-3' });
    await flush();

    // sub-a (all) + sub-b (issue.created) match; sub-c (sprint.started) does not
    expect(queueAddMock).toHaveBeenCalledTimes(2);
    const jobSubIds = queueAddMock.mock.calls.map(
      (c) => (c[1] as { sub: { id: string } }).sub.id,
    );
    expect(jobSubIds).toContain('sub-a');
    expect(jobSubIds).toContain('sub-b');
    expect(jobSubIds).not.toContain('sub-c');
  });
});

// ---- Tests: executeDelivery (shared delivery logic) ------------------------

describe('executeDelivery — shared SSRF + HMAC delivery logic', () => {
  const realFetch = global.fetch;
  const realEnv = process.env.WEBHOOK_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (realEnv === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
    else process.env.WEBHOOK_ALLOW_PRIVATE = realEnv;
    jest.restoreAllMocks();
  });

  function makeSub(url: string) {
    return {
      id: SUB_ID,
      projectId: PROJECT,
      url,
      events: [],
      active: true,
      createdAt: new Date().toISOString(),
    };
  }

  const testPayload = {
    event: WebhookEventTypes.IssueCreated,
    projectId: PROJECT,
    timestamp: new Date().toISOString(),
    data: { id: 'i-42' },
  };

  it('blocks delivery to 127.0.0.1 and returns SSRF error (fetch never called)', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeDelivery(makeSub('http://127.0.0.1/hook'), SECRET, testPayload);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SSRF blocked/i);
  });

  it('blocks delivery to 169.254.169.254 (cloud metadata) and returns SSRF error', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeDelivery(
      makeSub('http://169.254.169.254/latest/meta-data/'),
      SECRET,
      testPayload,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SSRF blocked/i);
  });

  it('signs the outbound request with the correct HMAC', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeDelivery(makeSub(HOOK_URL), SECRET, testPayload);

    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expectedSig = signPayload(SECRET, init.body as string);
    expect(headers['X-NextLane-Signature']).toBe(expectedSig);
    expect(headers['X-NextLane-Event']).toBe(WebhookEventTypes.IssueCreated);
  });

  it('returns failed result when the receiver returns a non-2xx status', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeDelivery(makeSub(HOOK_URL), SECRET, testPayload);

    expect(result.success).toBe(false);
    expect(result.responseStatus).toBe(500);
  });

  it('sets redirect:"manual" to prevent SSRF via 3xx redirect', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dnsModule = require('node:dns') as typeof import('node:dns');
    jest
      .spyOn(dnsModule.promises, 'lookup')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;

    await executeDelivery(makeSub(HOOK_URL), SECRET, testPayload);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('bypasses SSRF guard when WEBHOOK_ALLOW_PRIVATE=true (private IP allowed)', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';

    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeDelivery(
      makeSub('http://192.168.1.100/hook'),
      SECRET,
      testPayload,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});

// ---- Tests: no-op when REDIS_URL is unset (fallback path) ------------------

describe('WebhooksService (in-process mode) — no queue created when REDIS_URL unset', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    jest.clearAllMocks();
  });

  it('does not create a BullMQ Queue when REDIS_URL is unset', () => {
    const bullmq = jest.requireMock<{ Queue: jest.Mock; Worker: jest.Mock }>('bullmq');
    bullmq.Queue.mockClear();
    const prisma = makePrisma();
    new WebhooksService(prisma as unknown as PrismaService, mockAudit as unknown as AuditService);
    expect(bullmq.Queue).not.toHaveBeenCalled();
  });
});
