import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendHistory,
  getHistoryDir,
  getHistoryPath,
  readHistory,
  readRecentRuns,
} from './history';
import { parseEvent } from './state';

describe('history', () => {
  let tempDir: string;
  const originalEnv = process.env.AGENT_HQ_HOME;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hq-history-test-'));
    process.env.AGENT_HQ_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.AGENT_HQ_HOME = originalEnv;
    } else {
      delete process.env.AGENT_HQ_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('path resolution', () => {
    it('uses AGENT_HQ_HOME when defined', () => {
      process.env.AGENT_HQ_HOME = tempDir;
      expect(getHistoryDir()).toBe(tempDir);
      expect(getHistoryPath()).toBe(join(tempDir, 'history.jsonl'));
    });

    it('defaults to ~/.agent-hq when AGENT_HQ_HOME is undefined outside Vitest', () => {
      delete process.env.AGENT_HQ_HOME;
      const originalVitest = process.env.VITEST;
      delete process.env.VITEST;
      try {
        expect(getHistoryDir()).toBe(join(homedir(), '.agent-hq'));
        expect(getHistoryPath()).toBe(
          join(homedir(), '.agent-hq', 'history.jsonl'),
        );
      } finally {
        process.env.VITEST = originalVitest;
      }
    });

    it('rejects ~/.agent-hq when running under VITEST without AGENT_HQ_HOME', () => {
      delete process.env.AGENT_HQ_HOME;
      expect(() => getHistoryDir()).toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );
      expect(() => getHistoryPath()).toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );
    });

    it('rejects AGENT_HQ_HOME pointing to ~/.agent-hq or a subpath under VITEST', () => {
      process.env.AGENT_HQ_HOME = join(homedir(), '.agent-hq');
      expect(() => getHistoryDir()).toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );

      process.env.AGENT_HQ_HOME = join(homedir(), '.agent-hq', 'sub');
      expect(() => getHistoryDir()).toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );
    });

    it('rejects AGENT_HQ_HOME pointing directly to homedir under VITEST', () => {
      process.env.AGENT_HQ_HOME = homedir();
      expect(() => getHistoryDir()).toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );
    });
  });

  describe('appendHistory', () => {
    it('creates directory and appends valid event as a single line', async () => {
      const nestedDir = join(tempDir, 'nested', 'hq');
      process.env.AGENT_HQ_HOME = nestedDir;

      const event = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-100',
        ticketId: '42',
      });

      await appendHistory(event);

      const filePath = getHistoryPath();
      const content = await readFile(filePath, 'utf8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.event).toBe('TASK_START');
      expect(parsed.agent).toBe('codex');
      expect(parsed.runId).toBe('run-100');
      expect(parsed.ticketId).toBe('42');
    });

    it('appends multiple events line by line without overwriting', async () => {
      const event1 = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-1',
      });
      const event2 = parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'codex',
        runId: 'run-1',
        data: { exitCode: 0 },
      });

      await appendHistory(event1);
      await appendHistory(event2);

      const content = await readFile(getHistoryPath(), 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).event).toBe('TASK_START');
      expect(JSON.parse(lines[1]).event).toBe('TASK_COMPLETE');
    });

    it('logs error and does not throw when write fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      // Point AGENT_HQ_HOME to a file so mkdir fails with ENOTDIR
      const blockerFile = join(tempDir, 'blocker');
      await writeFile(blockerFile, 'file');
      process.env.AGENT_HQ_HOME = join(blockerFile, 'invalid-subdir');

      const event = parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-fail',
      });

      await expect(appendHistory(event)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to append event to history:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('rejects writing to ~/.agent-hq under VITEST', async () => {
      delete process.env.AGENT_HQ_HOME;
      const event = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-guard-test',
      });
      await expect(appendHistory(event)).rejects.toThrow(
        /Refusing to use .* during tests \(process\.env\.VITEST is set\)/,
      );
    });

    it('writes to directory captured at invocation time even if AGENT_HQ_HOME is mutated concurrently', async () => {
      const initialTemp = await mkdtemp(join(tmpdir(), 'hq-race-test-'));
      process.env.AGENT_HQ_HOME = initialTemp;

      const event = parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-race-test',
      });

      const appendPromise = appendHistory(event);
      process.env.AGENT_HQ_HOME = tempDir;
      await appendPromise;

      const initialContent = await readFile(
        join(initialTemp, 'history.jsonl'),
        'utf8',
      );
      expect(initialContent).toContain('run-race-test');
      await rm(initialTemp, { recursive: true, force: true });
    });
  });

  describe('readHistory', () => {
    it('returns empty array when file does not exist', async () => {
      const events = await readHistory();
      expect(events).toEqual([]);
    });

    it('reads all valid events and skips corrupt lines', async () => {
      const filePath = getHistoryPath();
      const validEvent1 = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-corrupt-test',
      });
      const validEvent2 = parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'codex',
        runId: 'run-corrupt-test',
      });

      const fileContent = [
        JSON.stringify(validEvent1),
        'not valid json {',
        '{"event":"INVALID_EVENT_TYPE","agent":"codex"}',
        '   ',
        JSON.stringify(validEvent2),
        '{"foo":"bar"}',
        '',
      ].join('\n');

      await writeFile(filePath, fileContent, 'utf8');

      const events = await readHistory();
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(validEvent1);
      expect(events[1]).toEqual(validEvent2);
    });
  });

  describe('readRecentRuns', () => {
    it('returns empty array when file does not exist', async () => {
      const runs = await readRecentRuns();
      expect(runs).toEqual([]);
    });

    it('groups events by runId and builds run metadata', async () => {
      const event1 = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-1',
        ticketId: '10',
        cwd: '/work/repo',
        pid: 1234,
        timestamp: '2026-10-22T10:00:00.000Z',
        data: { logFile: '/tmp/run-1.log' },
      });
      const event2 = parseEvent({
        event: 'DRAFT_PR_CREATED',
        agent: 'codex',
        runId: 'run-1',
        timestamp: '2026-10-22T10:01:00.000Z',
        data: { prNumber: 99 },
      });
      const event3 = parseEvent({
        event: 'TASK_COMPLETE',
        agent: 'codex',
        runId: 'run-1',
        timestamp: '2026-10-22T10:02:00.000Z',
        data: { exitCode: 0 },
      });

      await appendHistory(event1);
      await appendHistory(event2);
      await appendHistory(event3);

      const runs = await readRecentRuns();
      expect(runs).toHaveLength(1);

      const run = runs[0];
      expect(run.runId).toBe('run-1');
      expect(run.agent).toBe('codex');
      expect(run.status).toBe('complete');
      expect(run.ticketId).toBe('10');
      expect(run.cwd).toBe('/work/repo');
      expect(run.pid).toBe(1234);
      expect(run.logFile).toBe('/tmp/run-1.log');
      expect(run.exitCode).toBe(0);
      expect(run.data.prNumber).toBe(99);
      expect(run.startedAt).toBe('2026-10-22T10:00:00.000Z');
      expect(run.timestamp).toBe('2026-10-22T10:02:00.000Z');
      expect(run.durationMs).toBe(120000);
      expect(run.events).toHaveLength(3);
    });

    it('ignores events without runId when grouping runs', async () => {
      const eventWithoutRun = parseEvent({
        event: 'MERGED',
        agent: 'claude',
        data: { prNumber: 5 },
      });
      const eventWithRun = parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-with-id',
      });

      await appendHistory(eventWithoutRun);
      await appendHistory(eventWithRun);

      const runs = await readRecentRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe('run-with-id');
    });

    it('skips corrupt lines and continues reading runs', async () => {
      const event = parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-ok',
      });

      const content = [
        '{ truncated json',
        JSON.stringify(event),
        '{"random": true}',
      ].join('\n');

      await writeFile(getHistoryPath(), content, 'utf8');

      const runs = await readRecentRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe('run-ok');
    });

    it('orders runs newest first and respects limit', async () => {
      const run1 = parseEvent({
        event: 'TASK_START',
        agent: 'codex',
        runId: 'run-old',
        timestamp: '2026-10-22T08:00:00.000Z',
      });
      const run2 = parseEvent({
        event: 'TASK_START',
        agent: 'agy',
        runId: 'run-mid',
        timestamp: '2026-10-22T09:00:00.000Z',
      });
      const run3 = parseEvent({
        event: 'TASK_START',
        agent: 'claude',
        runId: 'run-newest',
        timestamp: '2026-10-22T10:00:00.000Z',
      });

      await appendHistory(run1);
      await appendHistory(run2);
      await appendHistory(run3);

      const allRuns = await readRecentRuns();
      expect(allRuns).toHaveLength(3);
      expect(allRuns.map((r) => r.runId)).toEqual([
        'run-newest',
        'run-mid',
        'run-old',
      ]);

      const limitedRuns = await readRecentRuns(2);
      expect(limitedRuns).toHaveLength(2);
      expect(limitedRuns.map((r) => r.runId)).toEqual([
        'run-newest',
        'run-mid',
      ]);

      const zeroRuns = await readRecentRuns(0);
      expect(zeroRuns).toEqual([]);
    });
  });
});
