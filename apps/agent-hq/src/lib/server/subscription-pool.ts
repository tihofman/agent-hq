import { EventEmitter } from 'node:events';
import { createRedisConnection, type Team } from '@agent-hq/queue';
import { detectRateLimit } from './ratelimit';
import type { Agent } from './state';

const preferences: Record<Team, readonly Agent[]> = {
  frontend: ['agy', 'claude'],
  backend: ['claude', 'agy'],
  qa: ['codex', 'agy'],
};
const providers = ['agy', 'claude', 'codex'] as const;
const key = 'subscription-pool:cooldowns';

type ProviderStatus = {
  status: 'AVAILABLE' | 'COOLDOWN';
  cooldownUntil: string | null;
};
type Pick = { provider: Agent } | { provider: null; cooldownUntil: string };
type Failover = {
  team: Team;
  from: Agent;
  to: Agent | null;
  cooldownUntil: string;
};

function pickAvailable(
  team: Team,
  status: Record<Agent, ProviderStatus>,
): Pick {
  const candidates = preferences[team];
  const provider = candidates.find((p) => status[p].status === 'AVAILABLE');
  if (provider) return { provider };
  return {
    provider: null,
    cooldownUntil: new Date(
      Math.min(...candidates.map((p) => Date.parse(status[p].cooldownUntil!))),
    ).toISOString(),
  };
}

/** Redis is contacted only by pool operations; importing this module never connects. */
export class SubscriptionPool extends EventEmitter<{
  SUBSCRIPTION_FAILOVER: [Failover];
}> {
  private connection?: ReturnType<typeof createRedisConnection>;
  private readonly defaultCooldownMs: number;

  constructor(options: { defaultCooldownMs?: number } = {}) {
    super();
    this.defaultCooldownMs = options.defaultCooldownMs ?? 15 * 60_000;
    if (!Number.isFinite(this.defaultCooldownMs) || this.defaultCooldownMs <= 0)
      throw new Error('defaultCooldownMs must be positive and finite');
  }

  private redis() {
    return (this.connection ??= createRedisConnection(undefined, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 2000,
      retryStrategy: () => null,
    }));
  }

  async status(): Promise<Record<Agent, ProviderStatus>> {
    const values = await this.redis().hgetall(key);
    const result = {} as Record<Agent, ProviderStatus>;
    for (const provider of providers) {
      const until = values[provider] ? Date.parse(values[provider]) : NaN;
      if (values[provider] && !Number.isFinite(until))
        throw new Error(`Invalid persisted cooldown for ${provider}`);
      result[provider] =
        until > Date.now()
          ? { status: 'COOLDOWN', cooldownUntil: new Date(until).toISOString() }
          : { status: 'AVAILABLE', cooldownUntil: null };
    }
    return result;
  }

  async pick(team: Team): Promise<Pick> {
    return pickAvailable(team, await this.status());
  }

  async reportRateLimit(
    provider: Agent,
    cooldownUntil?: string,
  ): Promise<void> {
    const until =
      cooldownUntil === undefined
        ? Date.now() + this.defaultCooldownMs
        : Date.parse(cooldownUntil);
    if (!Number.isFinite(until)) throw new Error('Invalid cooldownUntil');
    const status = await this.status();
    // A repeated diagnostic must not shorten an already known cooldown.
    const reset = new Date(
      Math.max(until, Date.parse(status[provider].cooldownUntil ?? '') || 0),
    ).toISOString();
    await this.redis().hset(key, provider, reset);
    const next = {
      ...status,
      [provider]: {
        status: Date.parse(reset) > Date.now() ? 'COOLDOWN' : 'AVAILABLE',
        cooldownUntil: reset,
      },
    } satisfies Record<Agent, ProviderStatus>;
    for (const team of Object.keys(preferences) as Team[]) {
      const from = pickAvailable(team, status).provider;
      const to = pickAvailable(team, next).provider;
      if (from === provider && to !== from)
        this.emit('SUBSCRIPTION_FAILOVER', {
          team,
          from,
          to,
          cooldownUntil: reset,
        });
    }
  }

  async reportOutput(provider: Agent, line: string): Promise<boolean> {
    const limit = detectRateLimit(line, new Date());
    if (!limit) return false;
    await this.reportRateLimit(provider, limit.cooldownUntil);
    return true;
  }

  close(): void {
    this.connection?.disconnect();
    this.connection = undefined;
  }
}
