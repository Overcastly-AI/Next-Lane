/**
 * SSO/OIDC Phase 2 — SAML replay-protection cache.
 *
 * `@node-saml/node-saml`'s `validatePostResponseAsync` correlates a callback
 * against the AuthnRequest that produced it (`InResponseTo`) via a
 * `CacheProvider` the library itself populates on `getAuthorizeUrlAsync`
 * (single-use — `removeAsync` on successful validation). The library's own
 * default (`InMemoryCacheProvider`) is explicitly documented as
 * process-local ("NOT sufficient" for multi-instance/load-balanced
 * deployments — see its own doc comment) — a login started on one API
 * replica and completed after a restart, or routed to a different replica,
 * would spuriously fail with "InResponseTo is not valid".
 *
 * This app already has an optional shared Redis (`RedisModule`, used by
 * BullMQ/the Socket.io adapter) — when `REDIS_URL` is configured, use it here
 * too so the replay window survives restarts and is shared across replicas.
 * Falls back to `InMemoryCacheProvider` (still correct for the common
 * single-instance self-host) when Redis isn't configured, so this never adds
 * a hard dependency.
 */
import { Injectable, Optional, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { CacheItem, CacheProvider } from '@node-saml/node-saml';
import { REDIS_CLIENT } from '../../redis/redis.module';

/** Key prefix so SAML replay-window entries are trivially greppable/flushable in a shared Redis instance. */
const KEY_PREFIX = 'nl:saml:inresponseto:';

class RedisCacheProvider implements CacheProvider {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs: number,
  ) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const item: CacheItem = { value, createdAt: Date.now() };
    await this.redis.set(KEY_PREFIX + key, JSON.stringify(item), 'PX', this.ttlMs);
    return item;
  }

  async getAsync(key: string): Promise<string | null> {
    const raw = await this.redis.get(KEY_PREFIX + key);
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as CacheItem).value;
    } catch {
      return null;
    }
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const value = await this.getAsync(key);
    await this.redis.del(KEY_PREFIX + key);
    return value;
  }
}

/**
 * Minimal single-process fallback (`REDIS_URL` unset). Deliberately NOT
 * `@node-saml/node-saml`'s own `InMemoryCacheProvider` — that class isn't
 * re-exported from the package's public entrypoint (only its internal
 * `lib/in-memory-cache-provider` module), so depending on it would mean
 * importing an unstable internal path. This is a ~15-line equivalent:
 * same semantics (TTL-based expiry, single-use removal), same correctness
 * for the single-instance case this class documents as its own limitation.
 */
class InMemoryCacheProvider implements CacheProvider {
  private readonly store = new Map<string, CacheItem>();

  constructor(private readonly ttlMs: number) {}

  private prune(): void {
    const now = Date.now();
    for (const [key, item] of this.store) {
      if (now - item.createdAt > this.ttlMs) this.store.delete(key);
    }
  }

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    this.prune();
    const item: CacheItem = { value, createdAt: Date.now() };
    this.store.set(key, item);
    return item;
  }

  async getAsync(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() - item.createdAt > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const value = await this.getAsync(key);
    this.store.delete(key);
    return value;
  }
}

/**
 * SSO/OIDC Phase 2 — 5-minute replay window (tighter than node-saml's own
 * 8h default), matching the legacy OIDC state token's 10-minute expiry order
 * of magnitude: a SAML login is a synchronous browser round-trip, not
 * something a user completes hours later.
 */
export const SAML_REQUEST_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SamlCacheProviderFactory {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  create(): CacheProvider {
    if (this.redis) {
      return new RedisCacheProvider(this.redis, SAML_REQUEST_TTL_MS);
    }
    return new InMemoryCacheProvider(SAML_REQUEST_TTL_MS);
  }
}
