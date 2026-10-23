import { Redis, type RedisOptions } from 'ioredis';

export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

export function calculateBackoff(times: number, maxDelayMs = 3000): number {
  if (times <= 0) return 50;
  return Math.min(Math.round(50 * Math.pow(1.5, times)), maxDelayMs);
}

export interface CreateRedisConnectionOptions extends RedisOptions {
  onError?: (err: Error) => void;
  maxDelayMs?: number;
}

export function createRedisConnection(
  url: string = process.env.REDIS_URL || DEFAULT_REDIS_URL,
  options?: CreateRedisConnectionOptions,
): Redis {
  const { onError, maxDelayMs = 3000, ...redisOptions } = options || {};

  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times: number) {
      return calculateBackoff(times, maxDelayMs);
    },
    ...redisOptions,
  });

  // Attach error listener to avoid unhandled EventEmitter error crashes
  client.on('error', (err: Error) => {
    if (onError) {
      onError(err);
    }
  });

  return client;
}
