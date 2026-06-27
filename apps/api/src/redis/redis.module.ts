/**
 * RedisModule — thin, optional Redis infrastructure layer.
 *
 * When REDIS_URL is set: exposes two named IORedis clients (pub + sub) for the
 * Socket.io adapter and a single connection-reuse client for BullMQ producers.
 * When REDIS_URL is unset: provides null tokens so consumers can branch
 * cleanly without crashing on import.
 *
 * This module is @Global so every other module gets the same client singletons
 * without re-importing.
 */
import { Global, Module, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/** Injection token for the pub client (used by @socket.io/redis-adapter). */
export const REDIS_PUB_CLIENT = 'REDIS_PUB_CLIENT';
/** Injection token for the sub client (used by @socket.io/redis-adapter). */
export const REDIS_SUB_CLIENT = 'REDIS_SUB_CLIENT';
/** Injection token for the shared BullMQ connection client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

function createClient(url: string, label: string): Redis {
  const logger = new Logger('RedisModule');
  const client = new Redis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  });
  client.on('connect', () => logger.log(`Redis ${label} connected`));
  client.on('error', (err: Error) =>
    logger.error(`Redis ${label} error: ${err.message}`),
  );
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_PUB_CLIENT,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        return createClient(url, 'pub');
      },
    },
    {
      provide: REDIS_SUB_CLIENT,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        return createClient(url, 'sub');
      },
    },
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;
        return createClient(url, 'main');
      },
    },
  ],
  exports: [REDIS_PUB_CLIENT, REDIS_SUB_CLIENT, REDIS_CLIENT],
})
export class RedisModule {}
