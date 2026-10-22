import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';
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
        if (
          !run.testing &&
          /\b(?:nx\s+test|vitest|pytest|jest)\b/i.test(plain)
        ) {
          run.testing = true;
          options.onEvent({ type: 'TEST_STARTED', agent });
        }
        if (stopped) break;
        if (
          run.testing &&
          /\b(?:\d+\s+(?:passed|failed)|FAIL|PASS)\b/.test(plain)
        ) {
          run.testing = false;
          options.onEvent({ type: 'TEST_FINISHED', agent });
        }
        if (stopped) break;
        const pr = plain.match(
          /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/([1-9]\d*)\b/,
        );
        if (pr && Number.isSafeInteger(Number(pr[1]))) {
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
  const watcher = watch(options.dir, scan);
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
