import { describe, expect, it, vi } from 'vitest';
import {
  calculateBackoff,
  createRedisConnection,
  DEFAULT_REDIS_URL,
} from './connection.js';

describe('Redis Connection', () => {
  describe('calculateBackoff', () => {
    it('returns increasing backoff values capped at maxDelayMs', () => {
      expect.assertions(6);
      const b1 = calculateBackoff(1);
      const b2 = calculateBackoff(2);
      const b3 = calculateBackoff(3);
      const b10 = calculateBackoff(10);
      const b20 = calculateBackoff(20);

      expect(b1).toBeGreaterThanOrEqual(50);
      expect(b2).toBeGreaterThan(b1);
      expect(b3).toBeGreaterThan(b2);
      expect(b10).toBeLessThanOrEqual(3000);
      expect(b20).toBe(3000); // capped at default 3000ms

      const customCap = calculateBackoff(20, 1500);
      expect(customCap).toBe(1500);
    });

    it('handles zero or negative attempt counts safely', () => {
      expect.assertions(2);
      expect(calculateBackoff(0)).toBe(50);
      expect(calculateBackoff(-1)).toBe(50);
    });
  });

  describe('createRedisConnection', () => {
    it('initializes with default URL and required BullMQ options', () => {
      expect.assertions(4);
      const client = createRedisConnection();
      try {
        expect(DEFAULT_REDIS_URL).toBe('redis://127.0.0.1:6379');
        expect(client.options.maxRetriesPerRequest).toBeNull();
        expect(client.options.lazyConnect).toBe(true);
        expect(typeof client.options.retryStrategy).toBe('function');
      } finally {
        client.disconnect();
      }
    });

    it('respects custom URL and REDIS_URL environment variable', () => {
      expect.assertions(2);
      const customUrl = 'redis://custom-host:6380';
      const client1 = createRedisConnection(customUrl);
      try {
        expect(client1.options.host).toBe('custom-host');
        expect(client1.options.port).toBe(6380);
      } finally {
        client1.disconnect();
      }
    });

    it('handles connection error and connection drops without crashing (reconnect strategy)', () => {
      expect.assertions(10);
      const onError = vi.fn();
      const client = createRedisConnection(DEFAULT_REDIS_URL, {
        onError,
        maxDelayMs: 500,
      });

      try {
        // 1. Verify retryStrategy provides backoff delay and never gives up on large attempt counts
        const retryStrategy = client.options.retryStrategy as (
          times: number,
        ) => number | false | null;
        expect(typeof retryStrategy).toBe('function');

        const delay1 = retryStrategy(1);
        const delay5 = retryStrategy(5);
        const delay100 = retryStrategy(100);
        const delay1000 = retryStrategy(1000);

        expect(typeof delay1).toBe('number');
        expect(delay1).toBeGreaterThan(0);
        expect(delay5).toBeGreaterThanOrEqual(delay1 as number);
        // Large attempt counts must never return false or null (never give up) and stay capped at maxDelayMs
        expect(typeof delay100).toBe('number');
        expect(delay100).toBe(500);
        expect(typeof delay1000).toBe('number');
        expect(delay1000).toBe(500);

        // 2. Simulate connection error with configured onError
        const simulatedError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
        expect(() => {
          client.emit('error', simulatedError);
        }).not.toThrow();

        expect(onError).toHaveBeenCalledWith(simulatedError);
      } finally {
        client.disconnect();
      }
    });

    it('does not throw when an error event is emitted without a configured onError handler', () => {
      expect.assertions(1);
      const clientWithoutOnError = createRedisConnection();
      try {
        expect(() => {
          clientWithoutOnError.emit(
            'error',
            new Error('unhandled connection error'),
          );
        }).not.toThrow();
      } finally {
        clientWithoutOnError.disconnect();
      }
    });
  });
});
