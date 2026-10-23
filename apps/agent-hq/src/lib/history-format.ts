import type { EventData } from './server/state';
import type { HistoryRun } from './server/history';

export interface HistoryRunItem extends HistoryRun {
  logExists: boolean;
  prUrl?: string | null;
}

export interface PrInfo {
  prNumber: number;
  url: string | null;
  label: string;
}

/**
 * Formats duration in milliseconds to a concise human-readable string.
 * Examples:
 * - <= 0 or invalid -> '0s'
 * - < 1000 -> '< 1s'
 * - < 60s -> 'Xs'
 * - < 1h -> 'Xm Ys' (or 'Xm' if Y=0)
 * - >= 1h -> 'Xh Ym' (or 'Xh' if Y=0)
 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0s';
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 1) return '< 1s';
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Formats a status string and optional exit code into a localized label.
 * Examples:
 * - ('complete', 0) -> 'Abgeschlossen (0)'
 * - ('complete', null) -> 'Abgeschlossen'
 * - ('failed', 2) -> 'Fehlgeschlagen (2)'
 * - ('running') -> 'Läuft'
 * - ('handover') -> 'Übergabe'
 * - ('aborted') -> 'Abgebrochen'
 */
export function formatStatusLabel(
  status: string,
  exitCode?: number | null,
): string {
  const codeSuffix =
    exitCode !== undefined && exitCode !== null ? ` (${exitCode})` : '';

  switch (status) {
    case 'complete':
      return `Abgeschlossen${codeSuffix}`;
    case 'failed':
      return `Fehlgeschlagen${codeSuffix}`;
    case 'aborted':
      return `Abgebrochen${codeSuffix}`;
    case 'running':
      return `Läuft${codeSuffix}`;
    case 'handover':
      return `Übergabe${codeSuffix}`;
    case 'cooldown':
      return `Cooldown${codeSuffix}`;
    case 'idle':
      return `Bereit${codeSuffix}`;
    case 'stale':
      return `Verwaist${codeSuffix}`;
    default:
      return `${status}${codeSuffix}`;
  }
}

/**
 * Extracts PR info and uses the server-resolved prUrl.
 * If prNumber is missing/invalid, returns null. If prUrl is missing, url is null.
 */
export function getPrInfo(
  data?:
    ((EventData | Record<string, unknown>) & { prUrl?: string | null }) | null,
  prUrl?: string | null,
): PrInfo | null {
  if (!data) return null;
  const rawPr = data.prNumber;
  if (typeof rawPr !== 'number' || !Number.isInteger(rawPr) || rawPr <= 0) {
    return null;
  }

  const resolvedUrl =
    prUrl ??
    (typeof (data as { prUrl?: unknown }).prUrl === 'string'
      ? (data as { prUrl: string }).prUrl
      : null);

  return {
    prNumber: rawPr,
    url: resolvedUrl?.trim() || null,
    label: `PR #${rawPr}`,
  };
}

/**
 * Formats a ticket ID (e.g. '18' -> '#18', '#18' -> '#18', missing -> '—').
 */
export function formatTicket(ticketId?: string | null): string {
  if (!ticketId || !ticketId.trim()) return '—';
  const clean = ticketId.trim();
  return clean.startsWith('#') ? clean : `#${clean}`;
}

/**
 * Formats an ISO timestamp for display in the run table (YYYY-MM-DD HH:MM:SS).
 */
export function formatRunTimestamp(isoString?: string): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'complete':
      return 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60';
    case 'failed':
      return 'bg-rose-950/80 text-rose-300 border-rose-700/60';
    case 'aborted':
      return 'bg-amber-950/80 text-amber-300 border-amber-700/60';
    case 'running':
      return 'bg-blue-950/80 text-blue-300 border-blue-700/60';
    case 'handover':
      return 'bg-purple-950/80 text-purple-300 border-purple-700/60';
    case 'stale':
      return 'bg-amber-950/80 text-amber-300 border-amber-700/60';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}

export function getAgentBadgeClass(agent: string): string {
  switch (agent?.toLowerCase()) {
    case 'claude':
      return 'bg-blue-950/80 text-blue-300 border-blue-700/60';
    case 'agy':
      return 'bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-700/60';
    case 'codex':
      return 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60';
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700';
  }
}
