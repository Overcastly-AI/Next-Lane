import { createHmac, randomBytes } from 'node:crypto';
import * as dns from 'node:dns';
import * as net from 'node:net';
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  WebhookEventTypes,
  type WebhookDeliveryDto,
  type WebhookEventPayload,
  type WebhookEventType,
  type WebhookSubscriptionDto,
} from '@next-lane/shared';
import { Queue, Worker, type Job } from 'bullmq';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pLimit = require('p-limit') as (concurrency: number) => (<T>(fn: () => Promise<T>) => Promise<T>);
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

// ---- SSRF protection -------------------------------------------------------

/**
 * Returns true if the given IP address (v4 or v6) is in a blocked range.
 *
 * Blocked ranges:
 *   IPv4: loopback 127.0.0.0/8, link-local 169.254.0.0/16,
 *         private 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *         this-network 0.0.0.0/8
 *   IPv6: loopback ::1, link-local fe80::/10, unique-local fc00::/7
 *
 * Gate: when process.env.WEBHOOK_ALLOW_PRIVATE === 'true' the caller should
 * skip this check entirely (see isBlockedUrl).
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    // 0.0.0.0/8 — this-network (also covers 0.0.0.0 as a default-route sentinel)
    if (a === 0) return true;
    // 127.0.0.0/8 — loopback
    if (a === 127) return true;
    // 10.0.0.0/8 — private class A
    if (a === 10) return true;
    // 172.16.0.0/12 — private class B (172.16–172.31)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 — private class C
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local / AWS metadata
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    // Normalise to lower-case for comparison.
    const lower = ip.toLowerCase();
    // ::1 — loopback
    if (lower === '::1') return true;
    // fe80::/10 — link-local (fe80 – febf)
    if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
    // fc00::/7 — unique-local (fc00 – fdff)
    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
    return false;
  }

  // Unknown address family — block by default (fail-closed).
  return true;
}

/**
 * Resolves the hostname in `urlString` to all its IP addresses and returns
 * `true` if any resolved address falls in a blocked range.
 *
 * When `WEBHOOK_ALLOW_PRIVATE=true` the blocklist is entirely skipped so
 * self-hosters can target internal infrastructure they control.
 */
export async function resolveAndCheckBlocked(urlString: string): Promise<{ blocked: boolean; reason?: string }> {
  if (process.env.WEBHOOK_ALLOW_PRIVATE === 'true') {
    return { blocked: false };
  }

  let hostname: string;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return { blocked: true, reason: 'invalid URL' };
  }

  // If the hostname is already a raw IP literal, check it directly.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { blocked: true, reason: `IP ${hostname} is in a blocked range` };
    }
    return { blocked: false };
  }

  // Resolve DNS to all addresses and check each one.
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    // DNS resolution failure — block (fail-closed; the host doesn't exist or
    // is unreachable; do not attempt to deliver).
    return { blocked: true, reason: `DNS lookup failed for ${hostname}: ${String(err)}` };
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return {
        blocked: true,
        reason: `Hostname ${hostname} resolved to blocked IP ${address}`,
      };
    }
  }
  return { blocked: false };
}

// How many recent delivery rows to keep per subscription; older rows are pruned
// after each delivery to keep the log bounded.
const MAX_DELIVERIES_PER_SUBSCRIPTION = 50;
// How many delivery rows the recent-deliveries endpoint returns.
const RECENT_DELIVERIES_LIMIT = 20;
// Outbound request timeout (ms). Deliveries are fire-and-forget regardless.
const DELIVERY_TIMEOUT_MS = 5000;
// Number of attempts (initial + retries) before recording a failed delivery.
const MAX_DELIVERY_ATTEMPTS = 2;
// BullMQ queue name.
export const WEBHOOK_QUEUE_NAME = 'webhook-delivery';
// BullMQ worker concurrency cap.
const WORKER_CONCURRENCY = 10;

type SubscriptionRow = {
  id: string;
  projectId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
};

type DeliveryRow = {
  id: string;
  subscriptionId: string;
  event: string;
  status: string;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
};

function toSubscriptionDto(s: SubscriptionRow): WebhookSubscriptionDto {
  return {
    id: s.id,
    projectId: s.projectId,
    url: s.url,
    events: s.events as WebhookEventType[],
    active: s.active,
    createdAt: s.createdAt.toISOString(),
  };
}

function toDeliveryDto(d: DeliveryRow): WebhookDeliveryDto {
  return {
    id: d.id,
    subscriptionId: d.subscriptionId,
    event: d.event,
    status: d.status === 'success' ? 'success' : 'failed',
    responseStatus: d.responseStatus,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Compute the `sha256=<hmac>` signature value for a raw JSON body. */
export function signPayload(secret: string, rawBody: string): string {
  const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hmac}`;
}

// ---- Job payload shape (used by both the enqueuer and the worker) ----------

export interface WebhookJobData {
  sub: WebhookSubscriptionDto;
  /** The subscription secret — kept in the job body (BullMQ queue is internal). */
  secret: string;
  payload: WebhookEventPayload;
}

// ---- Shared per-delivery logic (called by both paths) ----------------------

/**
 * Attempt to POST the payload to a subscription's URL with an HMAC signature,
 * retrying on failure up to MAX_DELIVERY_ATTEMPTS, then return a delivery result.
 *
 * This is the single source of truth for delivery behaviour — both the
 * in-process fan-out and the BullMQ worker call this function so SSRF / HMAC
 * logic cannot drift between paths.
 *
 * SSRF protection: before sending, the target hostname is resolved to its IP
 * addresses and any address in a private/loopback/link-local range causes
 * delivery to be rejected. Gate via WEBHOOK_ALLOW_PRIVATE=true if you are a
 * self-hoster legitimately targeting internal infrastructure.
 *
 * Redirect safety: fetch is called with redirect:'manual' so a 3xx response
 * cannot redirect to an internal host after the pre-flight check.
 *
 * Socket leak fix: the response body is always drained so the undici connection
 * is released back to the pool even when we don't read the body content.
 */
export async function executeDelivery(
  sub: WebhookSubscriptionDto,
  secret: string,
  payload: WebhookEventPayload,
): Promise<{ success: boolean; responseStatus: number | null; error: string | null }> {
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(secret, rawBody);
  let responseStatus: number | null = null;
  let error: string | null = null;
  let success = false;

  // SSRF pre-flight: resolve hostname and check against blocked IP ranges.
  const ssrf = await resolveAndCheckBlocked(sub.url);
  if (ssrf.blocked) {
    const reason = ssrf.reason ?? 'blocked by SSRF policy';
    return {
      success: false,
      responseStatus: null,
      error: `SSRF blocked: ${reason}`,
    };
  }

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLane-Signature': signature,
          'X-NextLane-Event': payload.event,
        },
        body: rawBody,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        // Prevent a 30x from bouncing to an internal host after the SSRF check.
        redirect: 'manual',
      });
      responseStatus = res.status;

      // Always drain the body to release the underlying TCP socket back to the
      // connection pool; ignoring the body content is intentional.
      await res.text().catch(() => undefined);

      if (res.ok) {
        success = true;
        error = null;
        break;
      }
      error = `Receiver responded ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      responseStatus = null;
    }
  }

  return { success, responseStatus, error };
}

// ---- Service ---------------------------------------------------------------

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly queue: Queue<WebhookJobData> | null;
  private worker: Worker<WebhookJobData> | null = null;

  constructor(private readonly prisma: PrismaService) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      // BullMQ accepts a URL string as its connection — this avoids any ioredis
      // version mismatch between BullMQ's internal peer and our own ioredis.
      const connection = { url: redisUrl, maxRetriesPerRequest: null as null };
      this.queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      });
      this.logger.log('Webhook delivery queue initialised (BullMQ / Redis mode)');
      this.startWorker(connection);
    } else {
      this.queue = null;
      this.logger.log('Webhook delivery queue disabled (REDIS_URL not set; in-process mode)');
    }
  }

  /** Start the BullMQ worker that processes delivery jobs. */
  private startWorker(connection: { url: string; maxRetriesPerRequest: null }): void {
    this.worker = new Worker<WebhookJobData>(
      WEBHOOK_QUEUE_NAME,
      async (job: Job<WebhookJobData>) => {
        const { sub, secret, payload } = job.data;
        this.logger.debug(
          `Processing webhook job ${job.id} for subscription ${sub.id} (event=${payload.event})`,
        );
        const result = await executeDelivery(sub, secret, payload);
        if (!result.success && result.error?.startsWith('SSRF blocked')) {
          // SSRF-blocked deliveries should not be retried — record and done.
          this.logger.warn(
            `Webhook delivery to ${sub.url} blocked by SSRF policy (subscriptionId=${sub.id})`,
          );
        }
        await this.recordDelivery(sub.id, payload.event, result);
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY,
      },
    );

    this.worker.on('failed', (job, err: Error) => {
      this.logger.error(
        `Webhook job ${job?.id ?? '?'} failed after retries: ${err.message}`,
      );
    });
    this.worker.on('error', (err: Error) => {
      this.logger.error(`BullMQ worker error: ${err.message}`);
    });
  }

  // ---- CRUD (admin-only, project-scoped) ---------------------------------

  async findAll(
    userId: string,
    projectId: string,
  ): Promise<WebhookSubscriptionDto[]> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map(toSubscriptionDto);
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateWebhookDto,
  ): Promise<WebhookSubscriptionDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.ADMIN);
    const sub = await this.prisma.webhookSubscription.create({
      data: {
        projectId,
        url: dto.url,
        secret: dto.secret ?? randomBytes(24).toString('hex'),
        events: dto.events ?? [],
        active: dto.active ?? true,
      },
    });
    return toSubscriptionDto(sub);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<WebhookSubscriptionDto> {
    const existing = await this.requireSubscription(id);
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);
    const sub = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        url: dto.url,
        secret: dto.secret, // undefined leaves the existing secret intact
        events: dto.events,
        active: dto.active,
      },
    });
    return toSubscriptionDto(sub);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.requireSubscription(id);
    await assertProjectRole(this.prisma, userId, existing.projectId, Role.ADMIN);
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { id };
  }

  async deliveries(
    userId: string,
    id: string,
  ): Promise<WebhookDeliveryDto[]> {
    const existing = await this.requireSubscription(id);
    await assertProjectMember(this.prisma, userId, existing.projectId);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: 'desc' },
      take: RECENT_DELIVERIES_LIMIT,
    });
    return rows.map(toDeliveryDto);
  }

  /** Send a sample event to a single subscription so admins can verify setup. */
  async sendTest(
    userId: string,
    id: string,
  ): Promise<{ ok: true }> {
    const sub = await this.requireSubscription(id);
    await assertProjectRole(this.prisma, userId, sub.projectId, Role.ADMIN);
    const payload: WebhookEventPayload = {
      event: WebhookEventTypes.IssueCreated,
      projectId: sub.projectId,
      timestamp: new Date().toISOString(),
      data: { test: true, message: 'Next Lane webhook test event' },
    };
    // Awaited here (not fire-and-forget) so the admin sees the result reflected
    // in the delivery log promptly.  Errors are swallowed into a delivery row.
    if (this.queue) {
      await this.queue.add('test', {
        sub: toSubscriptionDto(sub),
        secret: sub.secret,
        payload,
      });
    } else {
      await this.deliverInProcess(toSubscriptionDto(sub), sub.secret, payload);
    }
    return { ok: true };
  }

  // ---- Event dispatch -----------------------------------------------------

  /**
   * Enqueue webhook deliveries for a domain event to all matching active
   * subscriptions of `projectId`. Fire-and-forget: never blocks or throws into
   * the caller (the originating request must not be affected by webhook I/O).
   *
   * When REDIS_URL is set: each (subscription, event) pair is enqueued as a
   * BullMQ job — durable, retried, deduplicated across replicas.
   * When REDIS_URL is unset: falls back to the original in-process p-limit
   * fan-out for zero-config single-node deployments.
   */
  dispatch(
    projectId: string,
    event: WebhookEventType,
    data: unknown,
  ): void {
    void this.dispatchAsync(projectId, event, data).catch((err) => {
      this.logger.error(
        `webhook dispatch failed for ${event} on project ${projectId}: ${String(err)}`,
      );
    });
  }

  private async dispatchAsync(
    projectId: string,
    event: WebhookEventType,
    data: unknown,
  ): Promise<void> {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { projectId, active: true },
    });
    const matching = subs.filter(
      (s) => s.events.length === 0 || s.events.includes(event),
    );
    if (matching.length === 0) return;

    const payload: WebhookEventPayload = {
      event,
      projectId,
      timestamp: new Date().toISOString(),
      data,
    };

    if (this.queue) {
      // Redis mode: enqueue one BullMQ job per matching subscription.
      await Promise.all(
        matching.map((s) =>
          this.queue!.add(event, {
            sub: toSubscriptionDto(s),
            secret: s.secret,
            payload,
          }).catch((err: Error) =>
            this.logger.error(
              `Failed to enqueue webhook job for sub ${s.id}: ${err.message}`,
            ),
          ),
        ),
      );
    } else {
      // In-process mode: original p-limit fan-out (unchanged).
      const limit = pLimit(10);
      await Promise.all(
        matching.map((s) =>
          limit(() =>
            this.deliverInProcess(toSubscriptionDto(s), s.secret, payload).catch(
              (err) =>
                this.logger.error(`webhook delivery error: ${String(err)}`),
            ),
          ),
        ),
      );
    }
  }

  /**
   * In-process delivery: calls executeDelivery() then records the result.
   * Used by the in-process fan-out path and the sendTest path (non-Redis mode).
   */
  private async deliverInProcess(
    sub: WebhookSubscriptionDto,
    secret: string,
    payload: WebhookEventPayload,
  ): Promise<void> {
    const result = await executeDelivery(sub, secret, payload);
    if (!result.success && result.error?.startsWith('SSRF blocked')) {
      this.logger.warn(
        `webhook delivery to ${sub.url} blocked: ${result.error} (subscriptionId=${sub.id})`,
      );
    }
    await this.recordDelivery(sub.id, payload.event, result);
  }

  private async recordDelivery(
    subscriptionId: string,
    event: string,
    result: { success: boolean; responseStatus: number | null; error: string | null },
  ): Promise<void> {
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          subscriptionId,
          event,
          status: result.success ? 'success' : 'failed',
          responseStatus: result.responseStatus,
          error: result.error?.slice(0, 1000) ?? null,
        },
      });
      await this.pruneDeliveries(subscriptionId);
    } catch (err) {
      this.logger.error(`failed to record webhook delivery: ${String(err)}`);
    }
  }

  /** Keep only the most recent N delivery rows for a subscription. */
  private async pruneDeliveries(subscriptionId: string): Promise<void> {
    const keep = await this.prisma.webhookDelivery.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      take: MAX_DELIVERIES_PER_SUBSCRIPTION,
      select: { id: true },
    });
    if (keep.length < MAX_DELIVERIES_PER_SUBSCRIPTION) return;
    await this.prisma.webhookDelivery.deleteMany({
      where: {
        subscriptionId,
        id: { notIn: keep.map((k) => k.id) },
      },
    });
  }

  private async requireSubscription(id: string): Promise<SubscriptionRow & { secret: string }> {
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!sub) throw new NotFoundException('Webhook subscription not found');
    return sub;
  }
}
