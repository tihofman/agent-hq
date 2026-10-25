import type { Agent } from '@agent-hq/queue/types';

// API contract types live in @agent-hq/queue/types; only TUI-local types here.

export const AGENTS: readonly Agent[] = ['claude', 'agy', 'codex'] as const;

export interface SSEMessage {
  event: string;
  data: string;
}
