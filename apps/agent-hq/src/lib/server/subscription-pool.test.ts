import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRateLimit } from './ratelimit';
import { SubscriptionPool } from './subscription-pool';

const redis = vi.hoisted(() => {
  const values: Record<string, string> = {};
  return {
    values,
    hgetall: vi.fn(async () => ({ ...values })),
    hset: vi.fn(async (_key: string, provider: string, value: string) => {
      values[provider] = value;
      return 1;
    }),
    disconnect: vi.fn(),
  };
});
vi.mock('@agent-hq/queue', () => ({
  createRedisConnection: vi.fn(() => redis),
}));
import { createRedisConnection } from '@agent-hq/queue';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
  for (const key of Object.keys(redis.values)) delete redis.values[key];
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('SubscriptionPool', () => {
  it('connects only on use and selects team preferences', async () => {
    const pool = new SubscriptionPool();
    expect(createRedisConnection).not.toHaveBeenCalled();
    expect(await pool.pick('frontend')).toEqual({ provider: 'agy' });
    expect(await pool.pick('backend')).toEqual({ provider: 'claude' });
    expect(await pool.pick('qa')).toEqual({ provider: 'codex' });
    pool.close();
  });

  it('persists cooldown, emits exact failover payloads and expires at the reset', async () => {
    const pool = new SubscriptionPool();
    const emit = vi.fn();
    pool.on('SUBSCRIPTION_FAILOVER', emit);
    const cooldownUntil = '2026-10-22T12:01:00.000Z';
    await pool.reportRateLimit('agy', cooldownUntil);
    expect(emit.mock.calls).toEqual([
      [{ team: 'frontend', from: 'agy', to: 'claude', cooldownUntil }],
    ]);
    expect(await new SubscriptionPool().pick('frontend')).toEqual({
      provider: 'claude',
    });
    expect((await pool.status()).agy).toEqual({
      status: 'COOLDOWN',
      cooldownUntil,
    });
    vi.advanceTimersByTime(60_000);
    expect(await pool.pick('frontend')).toEqual({ provider: 'agy' });
    expect((await pool.status()).agy).toEqual({
      status: 'AVAILABLE',
      cooldownUntil: null,
    });
  });

  it('returns earliest team reset when blocked, ignoring unrelated providers', async () => {
    const pool = new SubscriptionPool({ defaultCooldownMs: 120_000 });
    await pool.reportRateLimit('agy');
    await pool.reportRateLimit('claude', '2026-10-22T12:03:00Z');
    await pool.reportRateLimit('codex', '2026-10-22T12:01:00Z');
    expect(await pool.pick('frontend')).toEqual({
      provider: null,
      cooldownUntil: '2026-10-22T12:02:00.000Z',
    });
    expect(await pool.pick('qa')).toEqual({
      provider: null,
      cooldownUntil: '2026-10-22T12:01:00.000Z',
    });
  });

  it('emits fallback changes for backend and qa, including exhausted preferences', async () => {
    const pool = new SubscriptionPool();
    const emit = vi.fn();
    pool.on('SUBSCRIPTION_FAILOVER', emit);
    const cooldownUntil = '2026-10-22T12:01:00.000Z';
    await pool.reportRateLimit('claude', cooldownUntil);
    expect(await pool.pick('backend')).toEqual({ provider: 'agy' });
    await pool.reportRateLimit('codex', cooldownUntil);
    expect(await pool.pick('qa')).toEqual({ provider: 'agy' });
    await pool.reportRateLimit('agy', cooldownUntil);
    expect(emit.mock.calls).toEqual([
      [{ team: 'backend', from: 'claude', to: 'agy', cooldownUntil }],
      [{ team: 'qa', from: 'codex', to: 'agy', cooldownUntil }],
      [{ team: 'frontend', from: 'agy', to: null, cooldownUntil }],
      [{ team: 'backend', from: 'agy', to: null, cooldownUntil }],
      [{ team: 'qa', from: 'agy', to: null, cooldownUntil }],
    ]);
  });

  it('keeps later resets on repeated reports and validates persisted state', async () => {
    const pool = new SubscriptionPool();
    await pool.reportRateLimit('agy', '2026-10-22T12:05:00Z');
    await pool.reportRateLimit('agy', '2026-10-22T12:01:00Z');
    expect((await pool.status()).agy.cooldownUntil).toBe(
      '2026-10-22T12:05:00.000Z',
    );
    redis.values.agy = 'corrupt';
    await expect(pool.pick('frontend')).rejects.toThrow(
      'Invalid persisted cooldown',
    );
    expect(() => new SubscriptionPool({ defaultCooldownMs: 0 })).toThrow();
  });

  it.each([
    {
      fixture: 'agy-quota',
      provider: 'agy' as const,
      team: 'frontend' as const,
      fallback: 'claude' as const,
    },
    {
      fixture: 'gemini-reset',
      provider: 'agy' as const,
      team: 'frontend' as const,
      fallback: 'claude' as const,
    },
    {
      fixture: 'claude-clock',
      provider: 'claude' as const,
      team: 'backend' as const,
      fallback: 'agy' as const,
    },
    {
      fixture: 'codex-date',
      provider: 'codex' as const,
      team: 'qa' as const,
      fallback: 'agy' as const,
    },
  ])(
    'uses existing detection fixture $fixture with matching provider $provider',
    async ({ fixture, provider, team, fallback }) => {
      const pool = new SubscriptionPool({ defaultCooldownMs: 30_000 });
      const line = readFileSync(
        join(import.meta.dirname, '__fixtures__/ratelimit', `${fixture}.txt`),
        'utf8',
      )
        .split('\n')
        .slice(1)
        .join('\n')
        .trim();
      const detected = detectRateLimit(line, new Date());
      expect(await pool.reportOutput(provider, 'ordinary output')).toBe(false);
      expect(await pool.reportOutput(provider, line)).toBe(true);
      const status = await pool.status();
      expect(status[provider].status).toBe('COOLDOWN');
      if (detected?.cooldownUntil) {
        expect(status[provider].cooldownUntil).toBe(detected.cooldownUntil);
      } else {
        expect(fixture).toBe('agy-quota');
        expect(status[provider].cooldownUntil).toBe('2026-10-22T12:00:30.000Z');
      }
      expect(await pool.pick(team)).toEqual({ provider: fallback });
    },
  );

  it('rejects invalid cooldowns and surfaces Redis failures only on use', async () => {
    const pool = new SubscriptionPool();
    await expect(pool.reportRateLimit('agy', 'invalid')).rejects.toThrow();
    redis.hgetall.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(pool.pick('qa')).rejects.toThrow('Redis unavailable');
  });
});
