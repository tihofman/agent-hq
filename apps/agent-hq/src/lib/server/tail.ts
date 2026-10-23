import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
import { detectRateLimit } from './ratelimit';
import {
  parseEvent,
  type Agent,
  type HQEvent,
  type InternalAction,
} from './state';

export function startTail(options: {
  dir: string;
  onEvent: (event: HQEvent | InternalAction) => void;
  resolveAgent: (runId: string) => Agent | undefined;
  isRunActive?: (runId: string) => boolean;
}): () => void {
  const runs = new Map<
    string,
    {
      position: number;
      decoder: StringDecoder;
      pending: string;
      testing: boolean;
      prCreated: boolean;
      rateLimited?: { cooldownUntil?: string };
    }
  >();
  const finished = new Set<string>();
  let stopped = false;

  function scan() {
    if (stopped) return;
    for (const entry of readdirSync(options.dir, { withFileTypes: true })) {
      if (stopped) return;
      const name = entry.name;
      if (!entry.isFile() || !name.endsWith('.log')) continue;
      const runId = name.slice(0, -4);
      if (!runId.trim() || finished.has(runId)) continue;
      if (options.isRunActive?.(runId) === false) {
        runs.delete(runId);
        finished.add(runId);
        continue;
      }
      let run = runs.get(runId);
      if (!run) {
        run = {
          position: 0,
          decoder: new StringDecoder('utf8'),
          pending: '',
          testing: false,
          prCreated: false,
        };
        runs.set(runId, run);
      }
      const agent = options.resolveAgent(runId);
      let fd: number;
      try {
        fd = openSync(join(options.dir, name), 'r');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      // Close before callbacks, including when stop() is called from onEvent.
      let text = '';
      try {
        if (fstatSync(fd).size < run.position) {
          run.position = 0;
          run.pending = '';
          run.decoder = new StringDecoder('utf8');
        }
        const buffer = Buffer.alloc(64 * 1024);
        let bytes: number;
        while (
          (bytes = readSync(fd, buffer, 0, buffer.length, run.position)) > 0
        ) {
          run.position += bytes;
          text += run.decoder.write(buffer.subarray(0, bytes));
        }
      } finally {
        closeSync(fd);
      }
      if (!agent) {
        run.pending = '';
        run.decoder = new StringDecoder('utf8');
        continue;
      }
      const lines = (run.pending + text).split('\n');
      run.pending = lines.pop()!;
      for (const line of lines) {
        if (stopped || options.isRunActive?.(runId) === false) break;
        options.onEvent(
          parseEvent({
            event: 'TASK_PROGRESS',
            agent,
            runId,
            data: { logChunk: line + '\n' },
          }),
        );
        if (stopped) break;
        const plain = stripVTControlCharacters(line);
        const now = new Date();
        const limit = detectRateLimit(plain, now);
        const until = run.rateLimited?.cooldownUntil;
        // Mirrors state.ts: an elapsed cooldown always re-arms; an open-ended one only after regular output.
        if (until ? now >= new Date(until) : !limit)
          run.rateLimited = undefined;
        if (
          limit &&
          (!run.rateLimited ||
            (limit.cooldownUntil &&
              (!run.rateLimited.cooldownUntil ||
                limit.cooldownUntil > run.rateLimited.cooldownUntil)))
        ) {
          run.rateLimited = limit;
          options.onEvent(
            parseEvent({ event: 'RATE_LIMITED', agent, runId, data: limit }),
          );
        }
        if (stopped) break;
        if (
          !run.testing &&
          /(?:^|[>$])\s*(?:npx\s+|nx\s+run\s+\S*:\s*)?(?:nx\s+test|vitest(?:\s+run)?|pytest|jest)(?=\s|$)/i.test(
            plain,
          )
        ) {
          run.testing = true;
          options.onEvent({ type: 'TEST_STARTED', agent });
        }
        if (stopped) break;
        if (
          run.testing &&
          /^\s*(?:(?:Test Files|Tests)\s+.*\b(?:passed|failed)\b|Tests:\s+.*\b(?:passed|failed)\b|=+\s+\d+\s+(?:passed|failed)\b)/.test(
            plain,
          )
        ) {
          run.testing = false;
          options.onEvent({ type: 'TEST_FINISHED', agent });
        }
        if (stopped) break;
        const pr = plain.match(
          /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/([1-9]\d*)\s*$/,
        );
        if (!run.prCreated && pr && Number.isSafeInteger(Number(pr[1]))) {
          run.prCreated = true;
          options.onEvent(
            parseEvent({
              event: 'DRAFT_PR_CREATED',
              agent,
              runId,
              data: { prNumber: Number(pr[1]) },
            }),
          );
        }
      }
    }
  }

  mkdirSync(options.dir, { recursive: true });
  const watcher = watch(options.dir, () => {
    try {
      scan();
    } catch (error) {
      console.error('Log tail scan failed:', error);
    }
  });
  watcher.on('error', (error) => {
    console.error('Log tail watcher failed:', error);
  });
  try {
    scan();
  } catch (error) {
    watcher.close();
    throw error;
  }
  return () => {
    if (stopped) return;
    stopped = true;
    watcher.close();
    runs.clear();
    finished.clear();
  };
}
