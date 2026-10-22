import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Criterion {
  text: string;
  done: boolean;
}

export interface TicketData {
  number: number;
  title: string;
  criteria: Criterion[];
}

export type TicketResponse = TicketData;

export interface Ticket {
  number: number;
  title: string;
  body: string;
}

export class TicketNotFoundError extends Error {
  constructor(message = 'Ticket not found') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export class GitHubCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubCliError';
  }
}

export function parseCriteria(body: string): Criterion[] {
  if (!body || typeof body !== 'string') return [];
  const headingMatch = body.match(
    /(?:^|\r?\n)##\s+Akzeptanzkriterien[^\r\n]*\r?\n([\s\S]*?)(?=(?:\r?\n##\s+)|$)/i,
  );
  if (!headingMatch) return [];

  const section = headingMatch[1];
  const lines = section.split(/\r?\n/);
  const criteria: Criterion[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (match) {
      criteria.push({
        text: match[2].trim(),
        done: match[1].toLowerCase() === 'x',
      });
    }
  }

  return criteria;
}

interface CacheEntry {
  ticket: Ticket;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function clearTicketCache(): void {
  cache.clear();
}

export type ExecFileFunction = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export async function fetchTicket(
  ticketId: string,
  cwd: string,
  execFn: ExecFileFunction = execFileAsync,
): Promise<Ticket> {
  const normalizedId = ticketId.trim().replace(/^#/, '');
  if (!/^\d+$/.test(normalizedId)) {
    throw new TicketNotFoundError('Invalid ticket ID');
  }

  const cacheKey = `${cwd}::${normalizedId}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.ticket;
  }

  try {
    const { stdout } = await execFn(
      'gh',
      ['issue', 'view', '--json', 'number,title,body', '--', normalizedId],
      {
        cwd,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );

    const parsed = JSON.parse(stdout) as {
      number?: number;
      title?: string;
      body?: string;
    };

    const ticket: Ticket = {
      number: Number(parsed.number),
      title: String(parsed.title ?? ''),
      body: String(parsed.body ?? ''),
    };

    cache.set(cacheKey, { ticket, expiresAt: now + CACHE_TTL_MS });
    return ticket;
  } catch (err: unknown) {
    const error = err as {
      code?: string | number;
      killed?: boolean;
      signal?: string;
      stderr?: string;
      message?: string;
    };

    if (error.code === 'ENOENT') {
      throw new GitHubCliError(
        'GitHub CLI (gh) is not installed or not in PATH',
      );
    }

    if (
      error.killed ||
      error.signal === 'SIGTERM' ||
      error.code === 'ETIMEDOUT'
    ) {
      throw new GitHubCliError('GitHub CLI (gh) timed out after 5 seconds');
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const message = typeof error.message === 'string' ? error.message : '';
    const combined = `${stderr} ${message}`.toLowerCase();

    if (
      combined.includes('could not resolve to an issue') ||
      combined.includes('issue not found') ||
      combined.includes('no issue')
    ) {
      throw new TicketNotFoundError(`Ticket #${normalizedId} not found`);
    }

    throw new GitHubCliError(
      stderr.trim() || message || 'GitHub CLI (gh) execution failed',
    );
  }
}
