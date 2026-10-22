import type { Agent, HQEvent, InternalAction, Run } from './server/state';

export type FeedBadge = 'CLAUDE' | 'AGY' | 'CODEX' | 'TEST' | 'GIT';
export type FeedFilter = 'ALL' | FeedBadge;

export interface TextSegment {
  type: 'text' | 'bold' | 'code';
  content: string;
}

export interface PendingInputInfo {
  isPending: boolean;
  runId?: string;
  agent?: Agent;
  promptText?: string;
  timestamp?: string;
  remainingMs?: number;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

const TEST_COMMAND_REGEX =
  /(?:^|[>$])\s*(?:npx\s+|nx\s+run\s+\S*:\s*)?(?:nx\s+test|vitest(?:\s+run)?|pytest|jest)(?=\s|$)/i;
const TEST_RESULT_REGEX =
  /^\s*(?:PASS|FAIL|RUNS)\b|^\s*[✓✗✔✕]\s|^\s*(?:(?:Test Files|Tests)\s+.*\b(?:passed|failed)\b|Tests:\s+.*\b(?:passed|failed)\b|=+\s+\d+\s+(?:passed|failed)\b)/i;

export function isTestOutput(text: string): boolean {
  const plain = stripAnsi(text).trim();
  if (!plain) return false;
  return TEST_COMMAND_REGEX.test(plain) || TEST_RESULT_REGEX.test(plain);
}

export function isGitEvent(event: string): boolean {
  return (
    event === 'DRAFT_PR_CREATED' ||
    event === 'REVIEW_START' ||
    event === 'PR_READY' ||
    event.startsWith('CI_CHECK_') ||
    event === 'MERGED'
  );
}

export function getFeedBadges(item: HQEvent | InternalAction): FeedBadge[] {
  const badges: FeedBadge[] = [];

  if ('agent' in item && item.agent) {
    if (item.agent === 'claude') badges.push('CLAUDE');
    else if (item.agent === 'agy') badges.push('AGY');
    else if (item.agent === 'codex') badges.push('CODEX');
  }

  if ('event' in item) {
    if (isGitEvent(item.event)) {
      badges.push('GIT');
    }
    if (
      item.event === 'TASK_PROGRESS' &&
      item.data?.logChunk &&
      isTestOutput(item.data.logChunk)
    ) {
      badges.push('TEST');
    }
  } else if ('type' in item) {
    if (item.type === 'TEST_STARTED' || item.type === 'TEST_FINISHED') {
      badges.push('TEST');
    }
  }

  return badges;
}

export function filterFeed(
  items: (HQEvent | InternalAction)[],
  filter: FeedFilter,
): (HQEvent | InternalAction)[] {
  if (filter === 'ALL') return items;
  return items.filter((item) => getFeedBadges(item).includes(filter));
}

export function parseSimpleMarkdown(text: string): TextSegment[] {
  if (!text) return [];

  const tokens: TextSegment[] = [];
  const regex = /(?:`([^`\n]+)`|\*\*([^*\n]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    if (match[1] !== undefined) {
      tokens.push({
        type: 'code',
        content: match[1],
      });
    } else if (match[2] !== undefined) {
      tokens.push({
        type: 'bold',
        content: match[2],
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return tokens;
}

export function isPromptLine(text: string): boolean {
  const clean = stripAnsi(text).trim();
  if (!clean) return false;
  return clean.endsWith('?') || /(?:\[|\()y\/n(?:\]|\))/i.test(clean);
}

export function detectPendingInput(
  feed: (HQEvent | InternalAction)[],
  runs: Record<string, Run>,
  nowMs = Date.now(),
): PendingInputInfo {
  const activeRuns = Object.values(runs).filter((r) => r.status === 'running');
  if (activeRuns.length === 0) return { isPending: false };

  for (const run of activeRuns) {
    let lastProgress: HQEvent | undefined;
    for (let i = feed.length - 1; i >= 0; i--) {
      const item = feed[i];
      if (
        'event' in item &&
        item.event === 'TASK_PROGRESS' &&
        item.runId === run.runId &&
        item.data?.logChunk
      ) {
        lastProgress = item;
        break;
      }
    }

    if (!lastProgress || !lastProgress.data?.logChunk) continue;

    if (isPromptLine(lastProgress.data.logChunk)) {
      const eventTime = Date.parse(lastProgress.timestamp);
      const elapsed = Number.isFinite(eventTime) ? nowMs - eventTime : 0;
      const remainingMs = Math.max(0, 10_000 - elapsed);
      return {
        isPending: elapsed >= 10_000,
        runId: run.runId,
        agent: run.agent,
        promptText: stripAnsi(lastProgress.data.logChunk).trim(),
        timestamp: lastProgress.timestamp,
        remainingMs,
      };
    }
  }

  return { isPending: false };
}

export function getFeedMessageText(item: HQEvent | InternalAction): string {
  if ('event' in item) {
    if (item.event === 'TASK_PROGRESS') {
      const raw = item.data?.logChunk ?? item.data?.statusText ?? '';
      return stripAnsi(raw).replace(/\r?\n$/, '');
    }
    if (item.event === 'TASK_START') {
      return item.data?.title || item.data?.statusText || 'Task gestartet';
    }
    if (item.event === 'TASK_COMPLETE') {
      return (
        item.data?.statusText ||
        (item.data?.exitCode !== undefined
          ? `Task abgeschlossen (Exit ${item.data.exitCode})`
          : 'Task abgeschlossen')
      );
    }
    if (item.event === 'TASK_FAILED') {
      return (
        item.data?.statusText ||
        (item.data?.exitCode !== undefined
          ? `Task fehlgeschlagen (Exit ${item.data.exitCode})`
          : 'Task fehlgeschlagen')
      );
    }
    if (item.event === 'TASK_ABORTED') {
      return item.data?.statusText || 'Task abgebrochen';
    }
    if (item.event === 'TASK_HANDOVER') {
      return item.data?.title || item.data?.statusText || 'Task-Übergabe';
    }
    if (item.event === 'DRAFT_PR_CREATED') {
      return item.data?.prNumber
        ? `Draft PR #${item.data.prNumber} erstellt`
        : 'Draft PR erstellt';
    }
    if (item.event === 'REVIEW_START') {
      return item.data?.prNumber
        ? `Review gestartet für PR #${item.data.prNumber}`
        : 'Review gestartet';
    }
    if (item.event === 'PR_READY') {
      return item.data?.prNumber
        ? `PR #${item.data.prNumber} bereit für Review`
        : 'PR bereit für Review';
    }
    if (item.event === 'CI_CHECK_PASS') {
      return item.data?.prNumber
        ? `CI Checks bestanden (PR #${item.data.prNumber})`
        : 'CI Checks bestanden';
    }
    if (item.event === 'CI_CHECK_FAIL') {
      return item.data?.prNumber
        ? `CI Checks fehlgeschlagen (PR #${item.data.prNumber})`
        : 'CI Checks fehlgeschlagen';
    }
    if (item.event === 'MERGED') {
      return item.data?.prNumber
        ? `PR #${item.data.prNumber} gemergt`
        : 'PR gemergt';
    }
    if (item.event === 'RATE_LIMITED') {
      return item.data?.cooldownUntil
        ? `Rate-Limit: Cooldown bis ${item.data.cooldownUntil}`
        : 'Rate-Limit erreicht';
    }
    return (
      (item as HQEvent).data?.statusText ||
      (item as HQEvent).data?.title ||
      (item as HQEvent).event ||
      ''
    );
  }

  if ('type' in item) {
    if (item.type === 'TEST_STARTED') return 'Testlauf gestartet';
    if (item.type === 'TEST_FINISHED') return 'Testlauf beendet';
    if (item.type === 'ARRIVED') return 'Im Zielraum angekommen';
    if (item.type === 'DISMISS_ERROR') return 'Fehleranzeige zurückgesetzt';
    if (item.type === 'TICK') return 'Tick';
    return (item as { type: string }).type;
  }

  return '';
}

export function isLogChunk(item: HQEvent | InternalAction): boolean {
  return (
    'event' in item &&
    item.event === 'TASK_PROGRESS' &&
    Boolean(item.data?.logChunk)
  );
}

export function formatFeedTimestamp(isoString?: string): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 8);
}

export function getBadgeClass(badge: FeedBadge): string {
  switch (badge) {
    case 'CLAUDE':
      return 'bg-blue-950/80 text-blue-300 border-blue-700/60';
    case 'AGY':
      return 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-700/60';
    case 'CODEX':
      return 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60';
    case 'TEST':
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60';
    case 'GIT':
      return 'bg-amber-950/80 text-amber-300 border-amber-700/60';
  }
}

export function getFilterClass(filter: FeedFilter, active: boolean): string {
  if (active) {
    switch (filter) {
      case 'ALL':
        return 'bg-slate-700 text-white border-slate-500 font-bold';
      case 'CLAUDE':
        return 'bg-blue-900/90 text-blue-200 border-blue-500 font-bold';
      case 'AGY':
        return 'bg-fuchsia-900/90 text-fuchsia-200 border-fuchsia-500 font-bold';
      case 'CODEX':
        return 'bg-cyan-900/90 text-cyan-200 border-cyan-500 font-bold';
      case 'TEST':
        return 'bg-emerald-900/90 text-emerald-200 border-emerald-500 font-bold';
      case 'GIT':
        return 'bg-amber-900/90 text-amber-200 border-amber-500 font-bold';
    }
  }
  return 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700';
}
