import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Agent,
  type HQEvent,
  type InternalAction,
  parseEvent,
} from './state';
import { startTail } from './tail';

// Control duplicate/coalesced notifications independently of platform watch timing.
const signals = vi.hoisted(() => ({
  notify: () => {},
  close: vi.fn(),
  watcher: undefined as EventEmitter | undefined,
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: vi.fn((_dir: string, listener: () => void) => {
    signals.notify = listener;
    signals.watcher = Object.assign(new EventEmitter(), {
      close: signals.close,
    });
    return signals.watcher;
  }),
}));

describe('startTail', () => {
  let dir: string;
  let stop: (() => void) | undefined;
  let events: (HQEvent | InternalAction)[];
  const progress = () =>
    events.filter(
      (e): e is HQEvent => 'event' in e && e.event === 'TASK_PROGRESS',
    );
  const append = async (run: string, text: string | Buffer) => {
    await appendFile(join(dir, `${run}.log`), text);
    signals.notify();
    signals.notify();
  };
  const settle = async () => {
    signals.notify();
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hq-tail-'));
    events = [];
    signals.notify = () => {};
    signals.close.mockClear();
  });
  afterEach(async () => {
    stop?.();
    await rm(dir, { recursive: true, force: true });
  });
  function start(
    resolveAgent: (run: string) => Agent | undefined = () => 'codex',
    isRunActive?: (run: string) => boolean,
  ) {
    stop = startTail({
      dir,
      onEvent: (event) => events.push(event),
      resolveAgent,
      isRunActive,
    });
  }

  it('reads existing and new files once, buffering partial lines independently per run', async () => {
    await append('one', 'initial\npart');
    start((run) => (run === 'one' ? 'codex' : 'agy'));
    await append('two', 'other\n');
    await expect.poll(() => progress().length).toBe(2);
    await append('one', 'ial');
    await settle();
    expect(progress()).toHaveLength(2);
    await append('one', '\nnext\n');
    await append('two', 'second\n');
    await expect.poll(() => progress().length).toBe(5);
    expect(
      progress()
        .filter((e) => e.runId === 'one')
        .map((e) => e.data.logChunk),
    ).toEqual(['initial\n', 'partial\n', 'next\n']);
    expect(
      progress()
        .filter((e) => e.runId === 'two')
        .map((e) => e.agent),
    ).toEqual(['agy', 'agy']);
    for (const event of progress()) expect(parseEvent(event)).toEqual(event);
    await writeFile(join(dir, 'ignored.txt'), 'ignored\n');
    await settle();
    expect(progress()).toHaveLength(5);
  });

  it('reads coalesced appends for two runs on a single notification', async () => {
    start();
    await appendFile(join(dir, 'one.log'), 'a\n');
    await appendFile(join(dir, 'one.log'), 'b\n');
    await appendFile(join(dir, 'two.log'), 'c\n');
    signals.notify();
    signals.notify();
    expect(progress().map((e) => e.data.logChunk)).toEqual([
      'a\n',
      'b\n',
      'c\n',
    ]);
  });

  it('reads the first line of a new log when the write notification is lost', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      start(() => 'agy');
      await writeFile(join(dir, 'one.log'), '');
      signals.notify(); // The create notification can arrive before the first write.
      await appendFile(
        join(dir, 'one.log'),
        'You have exhausted your quota on this model.\n',
      );
      // No further watch notification: the first line must still be consumed.
      vi.advanceTimersByTime(1_000);
      expect(progress().map((e) => e.data.logChunk)).toEqual([
        'You have exhausted your quota on this model.\n',
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({ event: 'RATE_LIMITED', runId: 'one' }),
      );
      vi.advanceTimersByTime(1_000);
      expect(progress()).toHaveLength(1);
      stop!();
      await appendFile(join(dir, 'one.log'), 'after stop\n');
      vi.advanceTimersByTime(1_000);
      expect(progress()).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop?.();
      vi.useRealTimers();
    }
  });

  it('preserves UTF-8 characters split between appends', async () => {
    start();
    const bytes = Buffer.from('🙂\n');
    await append('one', bytes.subarray(0, 2));
    await settle();
    await append('one', bytes.subarray(2));
    await expect
      .poll(() => progress().map((e) => e.data.logChunk))
      .toEqual(['🙂\n']);
  });

  it.each([
    'nx test agent-hq',
    'vitest run',
    'pytest',
    'jest',
    '$ npx vitest run',
    '> jest',
    'nx run agent-hq:test: vitest run',
  ])('recognizes %s and test completion', async (command) => {
    start();
    await append('one', `${command}\n`);
    await expect.poll(() => events.filter((e) => 'type' in e).length).toBe(1);
    await append('one', 'Tests  12 passed\n');
    await expect
      .poll(() => events.filter((e) => 'type' in e))
      .toEqual([
        { type: 'TEST_STARTED', agent: 'codex' },
        { type: 'TEST_FINISHED', agent: 'codex' },
      ]);
  });

  it.each([
    '=== 3 passed in 0.1s ===',
    'Tests: 1 failed, 3 passed, 4 total',
    'Test Files  1 passed (1)',
  ])('finishes tests on %s and extracts PR URLs', async (result) => {
    start();
    await append(
      'one',
      `pytest\n${result}\nhttps://github.com/tihofman/agent-hq/pull/42\n`,
    );
    await expect.poll(() => events.length).toBe(6);
    expect(events).toContainEqual({ type: 'TEST_FINISHED', agent: 'codex' });
    expect(events.at(-1)).toMatchObject({
      event: 'DRAFT_PR_CREATED',
      runId: 'one',
      agent: 'codex',
      room: 'qa',
      data: { prNumber: 42 },
    });
  });

  it('emits validated RATE_LIMITED once per run, and again only for a later reset', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    try {
      start((run) => (run === 'one' ? 'agy' : 'claude'));
      const quota = 'You have exhausted your quota on this model.';
      await append('one', `${quota}\n${quota}\n`);
      await append(
        'one',
        `${quota} Retry-After: 60\n${quota} Retry-After: 60\n${quota} Retry-After: 30\n`,
      );
      await append('one', `${quota} Retry-After: 120\n${quota}\n`);
      await append('two', `${quota}\n`);
      const limits = events.filter(
        (e) => 'event' in e && e.event === 'RATE_LIMITED',
      );
      expect(limits).toMatchObject([
        { agent: 'agy', runId: 'one', room: 'lounge', data: {} },
        {
          agent: 'agy',
          runId: 'one',
          data: { cooldownUntil: '2026-10-22T12:01:00.000Z' },
        },
        {
          agent: 'agy',
          runId: 'one',
          data: { cooldownUntil: '2026-10-22T12:02:00.000Z' },
        },
        { agent: 'claude', runId: 'two', data: {} },
      ]);
      expect(limits).toHaveLength(4);
      for (const event of limits) expect(parseEvent(event)).toEqual(event);
      expect(progress()).toHaveLength(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms RATE_LIMITED after regular output once the cooldown elapsed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    try {
      start(() => 'agy');
      const quota = 'You have exhausted your quota on this model.';
      await append('one', `${quota}\nworking\n${quota}\n`);
      await append(
        'two',
        `${quota} Retry-After: 60\nretrying\n${quota} Retry-After: 60\n`,
      );
      vi.setSystemTime(new Date('2026-10-22T12:01:00Z'));
      await append('two', `working\n${quota}\n`);
      vi.setSystemTime(new Date('2026-10-22T12:02:00Z'));
      await append('three', `${quota} Retry-After: 60\n`);
      vi.setSystemTime(new Date('2026-10-22T12:03:00Z'));
      await append('three', `${quota}\n`);
      const limits = events.filter(
        (e) => 'event' in e && e.event === 'RATE_LIMITED',
      );
      expect(limits.map((e) => 'runId' in e && e.runId)).toEqual([
        'one',
        'one',
        'two',
        'two',
        'three',
        'three',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the offset, partial line and UTF-8 decoder after truncation', async () => {
    start();
    await append(
      'one',
      Buffer.concat([
        Buffer.from('initial\npending'),
        Buffer.from('🙂').subarray(0, 2),
      ]),
    );
    await writeFile(join(dir, 'one.log'), '');
    signals.notify();
    await append('one', 'new\n');
    expect(progress().map((e) => e.data.logChunk)).toEqual([
      'initial\n',
      'new\n',
    ]);
  });

  it('only emits one draft PR event per run for a standalone URL', async () => {
    start();
    const url = 'https://github.com/tihofman/agent-hq/pull/42';
    await append('one', `Created PR: ${url}\n`);
    expect(
      events.filter((e) => 'event' in e && e.event === 'DRAFT_PR_CREATED'),
    ).toEqual([]);
    await append(
      'one',
      `${url}\n${url}\nhttps://github.com/tihofman/agent-hq/pull/43\n`,
    );
    await append('two', `${url}\n`);
    expect(
      events.filter((e) => 'event' in e && e.event === 'DRAFT_PR_CREATED'),
    ).toMatchObject([
      { runId: 'one', data: { prNumber: 42 } },
      { runId: 'two', data: { prNumber: 42 } },
    ]);
  });

  it.each([
    'vitest.config.ts',
    'Please run pytest and jest after editing vitest.config.ts',
  ])('does not start testing for %s', async (line) => {
    start();
    await append('one', line + '\n');
    expect(events.filter((e) => 'type' in e)).toEqual([]);
  });

  it('does not finish Jest on an individual passing file', async () => {
    start();
    await append('one', 'jest\nPASS src/example.test.ts\n');
    expect(events.filter((e) => 'type' in e)).toEqual([
      { type: 'TEST_STARTED', agent: 'codex' },
    ]);
    await append('one', 'Tests: 2 passed, 2 total\n');
    expect(events.filter((e) => 'type' in e)).toEqual([
      { type: 'TEST_STARTED', agent: 'codex' },
      { type: 'TEST_FINISHED', agent: 'codex' },
    ]);
  });

  it('logs watcher errors without throwing', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      start();
      const error = new Error('watch failed');
      expect(() => signals.watcher!.emit('error', error)).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.any(String), error);
    } finally {
      log.mockRestore();
    }
  });

  it('logs scan failures in watch callbacks and continues watching', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('resolve failed');
    let fail = false;
    try {
      start(() => {
        if (fail) throw error;
        return 'codex';
      });
      await appendFile(join(dir, 'one.log'), 'hello\n');
      fail = true;
      expect(() => signals.notify()).not.toThrow();
      expect(log).toHaveBeenCalledWith(expect.any(String), error);
      fail = false;
      signals.notify();
      expect(progress().map((e) => e.data.logChunk)).toEqual(['hello\n']);
    } finally {
      log.mockRestore();
    }
  });

  it('ignores unknown runs until their agent is known', async () => {
    let agent: Agent | undefined = undefined;
    start(() => agent);
    await append('one', 'ignored\npartial');
    await settle();
    expect(events).toEqual([]);
    agent = 'agy';
    await append('one', 'known\n');
    await expect
      .poll(() => progress().map((e) => e.data.logChunk))
      .toEqual(['known\n']);
  });

  it('ignores completed runs while continuing other runs', async () => {
    let active = true;
    start(
      () => 'codex',
      (run) => run !== 'one' || active,
    );
    await append('one', 'first\n');
    await expect.poll(() => events.length).toBe(1);
    active = false;
    await append('one', 'ignored\n');
    await append('two', 'second\n');
    await expect.poll(() => events.length).toBe(2);
    expect(progress().map((e) => e.data.logChunk)).toEqual([
      'first\n',
      'second\n',
    ]);
  });

  it('closes its watcher and stops all callbacks, including repeated stop', async () => {
    start();
    expect(signals.close).not.toHaveBeenCalled();
    await append('one', 'first\n');
    await expect.poll(() => events.length).toBe(1);
    stop!();
    stop!();
    expect(signals.close).toHaveBeenCalledTimes(1);
    await append('one', 'ignored\n');
    await append('two', 'ignored\n');
    await settle();
    expect(events).toHaveLength(1);
  });
});
