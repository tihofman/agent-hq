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
const signals = vi.hoisted(() => ({ notify: () => {}, close: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  watch: vi.fn((_dir: string, listener: () => void) => {
    signals.notify = listener;
    return { close: signals.close };
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

  it.each(['nx test agent-hq', 'vitest run', 'pytest', 'jest'])(
    'recognizes %s and test completion',
    async (command) => {
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
    },
  );

  it.each(['3 passed', 'FAIL src/example.test.ts'])(
    'finishes tests on %s and extracts PR URLs',
    async (result) => {
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
    },
  );

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
