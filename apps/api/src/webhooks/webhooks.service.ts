import { createHmac, randomBytes } from 'node:crypto';
import {
  BadRequestException,
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
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import {
  assertSafeWebhookUrl,
  assertSafeWebhookUrlResolved,
  UnsafeWebhookUrlError,
} from './webhook-url.util';

// How many recent delivery rows to keep per subscription; older rows are pruned
// after each delivery to keep the log bounded.
const MAX_DELIVERIES_PER_SUBSCRIPTION = 50;
// How many delivery rows the recent-deliveries endpoint returns.
const RECENT_DELIVERIES_LIMIT = 20;
// Outbound request timeout (ms). Deliveries are fire-and-forget regardless.
const DELIVERY_TIMEOUT_MS = 5000;
// Number of attempts (initial + retries) before recording a failed delivery.
const MAX_DELIVERY_ATTEMPTS = 2;

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

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    this.assertSafeUrl(dto.url);
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
    if (dto.url !== undefined) this.assertSafeUrl(dto.url);
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
    // in the delivery log promptly, but failures are swallowed into a row.
    await this.deliver(toSubscriptionDto(sub), sub.secret, payload);
    return { ok: true };
  }

  // ---- Event dispatch -----------------------------------------------------

  /**
   * Enqueue webhook deliveries for a domain event to all matching active
   * subscriptions of `projectId`. Fire-and-forget: never blocks or throws into
   * the caller (the originating request must not be affected by webhook I/O).
   */
  dispatch(
    projectId: string,
    event: WebhookEventType,
    data: unknown,
  ): void {
    void this.dispatchAsync(projectId, event, data).catch((err) => {
      this.logger.error(
        `webhook dispatch failed for ${event} on project ${projectId}: ${String(
          err,
        )}`,
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
    await Promise.all(
      matching.map((s) =>
        this.deliver(toSubscriptionDto(s), s.secret, payload).catch((err) =>
          this.logger.error(`webhook delivery error: ${String(err)}`),
        ),
      ),
    );
  }

  /**
   * Attempt to POST the payload to a subscription's URL with an HMAC signature,
   * retrying on failure up to MAX_DELIVERY_ATTEMPTS, then record a delivery row.
   * Always resolves; never throws.
   */
  private async deliver(
    sub: WebhookSubscriptionDto,
    secret: string,
    payload: WebhookEventPayload,
  ): Promise<void> {
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(secret, rawBody);
    let responseStatus: number | null = null;
    let error: string | null = null;
    let success = false;

    // Re-validate the target at delivery time and resolve the hostname so a
    // host that was public when configured but now resolves to an internal
    // address (DNS rebinding) is blocked before any request is made.
    try {
      await assertSafeWebhookUrlResolved(sub.url);
    } catch (err) {
      const message =
        err instanceof UnsafeWebhookUrlError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      await this.recordDelivery(sub.id, payload.event, {
        success: false,
        responseStatus: null,
        error: `Blocked unsafe webhook target: ${message}`,
      });
      return;
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
        });
        responseStatus = res.status;
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

    await this.recordDelivery(sub.id, payload.event, {
      success,
      responseStatus,
      error,
    });
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

  /**
   * Reject webhook target URLs that point at internal/non-routable addresses
   * (SSRF hardening) at configuration time. Surfaced to the admin as a 400.
   */
  private assertSafeUrl(url: string): void {
    try {
      assertSafeWebhookUrl(url);
    } catch (err) {
      if (err instanceof UnsafeWebhookUrlError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private async requireSubscription(id: string): Promise<SubscriptionRow & { secret: string }> {
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!sub) throw new NotFoundException('Webhook subscription not found');
    return sub;
  }
}
