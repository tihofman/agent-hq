import { describe, expect, it, vi } from 'vitest';
import type { QueueEvents } from 'bullmq';
import * as queue from '@agent-hq/queue';
import { startIssueIngest, startConfiguredIssueIngest } from './issue-ingest';

describe('issue ingest', () => {
  it('routes once and skips any issue already carrying a status label', async () => {
    const add = vi.fn().mockResolvedValue({});
    const queueManager = {
      getQueue: vi.fn(() => ({ add, getJob: vi.fn() })),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const runGh = vi.fn(async (args: string[]) => {
      if (args[1] === 'list' && args[5] === 'team:backend')
        return JSON.stringify([
          {
            number: 12,
            title: 'Build API',
            body: 'body',
            labels: [{ name: 'team:backend' }],
          },
          {
            number: 13,
            title: 'Done already',
            body: '',
            labels: [{ name: 'team:backend' }, { name: 'status:done' }],
          },
        ]);
      if (args[1] === 'list') return '[]';
      return '';
    });
    const listeners = new Map<string, (data: { jobId: string }) => void>();
    const event = {
      on: vi.fn((name: string, listener: (data: { jobId: string }) => void) => {
        listeners.set(name, listener);
        return event;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const stop = startIssueIngest({
      queueManager,
      runGh,
      intervalMs: 60_000,
      queueEvents: () => event as unknown as Pick<QueueEvents, 'on' | 'close'>,
    });

    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(queueManager.getQueue).toHaveBeenCalledWith('backend');
    expect(add.mock.calls[0][2].jobId).not.toMatch(/^\d+$/);
    expect(add).toHaveBeenCalledWith(
      'Build API',
      expect.objectContaining({ issueId: 12, team: 'backend' }),
      { jobId: 'issue-12' },
    );
    expect(runGh).toHaveBeenCalledWith(
      expect.arrayContaining([
        'issue',
        'edit',
        '12',
        '--add-label',
        'status:queued',
      ]),
    );
    stop();
  });

  it('translates queue lifecycle events to issue status labels', async () => {
    const listeners = new Map<string, (data: { jobId: string }) => void>();
    const eventsFor = () => ({
      on: (name: string, listener: (data: { jobId: string }) => void) => {
        listeners.set(name, listener);
        return events;
      },
      close: vi.fn().mockResolvedValue(undefined),
    });
    const events = eventsFor();
    const runGh = vi.fn(async (args: string[]) => {
      void args;
      return '[]';
    });
    const stop = startIssueIngest({
      queueManager: {
        getQueue: vi.fn(() => ({
          add: vi.fn(),
          getJob: vi
            .fn()
            .mockResolvedValue({ attemptsMade: 3, opts: { attempts: 3 } }),
        })),
        close: vi.fn().mockResolvedValue(undefined),
      },
      runGh,
      queueEvents: eventsFor as never,
    });
    await vi.waitFor(() =>
      expect(runGh).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'list']),
      ),
    );
    runGh.mockClear();
    listeners.get('active')?.({ jobId: 'issue-14' });
    listeners.get('failed')?.({ jobId: 'issue-14' });
    listeners.get('completed')?.({ jobId: 'issue-14' });
    await vi.waitFor(() => expect(runGh).toHaveBeenCalledTimes(3));
    expect(runGh.mock.calls.map(([args]) => args?.[4])).toEqual([
      'status:in-progress',
      'status:blocked',
      'status:done',
    ]);
    stop();
  });

  it('warns and stays alive when gh is unavailable', async () => {
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const stop = startIssueIngest({
      queueManager: {
        getQueue: vi.fn(() => ({
          add: vi.fn(),
          getJob: vi
            .fn()
            .mockResolvedValue({ attemptsMade: 3, opts: { attempts: 3 } }),
        })),
        close: vi.fn().mockResolvedValue(undefined),
      },
      runGh: vi.fn().mockRejectedValue(new Error('missing gh')),
      queueEvents: () =>
        ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }) as never,
    });
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('poll failed'),
        expect.any(Error),
      ),
    );
    stop();
    warning.mockRestore();
  });
});

function harness() {
  const listeners = new Map<string, (data: { jobId: string }) => void>();
  const add = vi.fn().mockResolvedValue({});
  const getJob = vi
    .fn()
    .mockResolvedValue({ attemptsMade: 1, opts: { attempts: 3 } });
  const close = vi.fn().mockResolvedValue(undefined);
  const eventsClose = vi.fn().mockResolvedValue(undefined);
  const runGh = vi.fn(async (args: string[]) =>
    args[1] === 'list'
      ? JSON.stringify(
          args[5] === 'team:backend'
            ? [{ number: 12, title: 'API', body: '', labels: [] }]
            : [],
        )
      : '',
  );
  const start = () =>
    startIssueIngest({
      queueManager: { getQueue: () => ({ add, getJob }), close },
      runGh,
      intervalMs: 20_000,
      queueEvents: () =>
        ({
          on: (name: string, handler: (data: { jobId: string }) => void) => {
            listeners.set(name, handler);
          },
          close: eventsClose,
        }) as never,
    });
  const emit = (name: string, jobId = 'issue-12') =>
    listeners.get(name)?.({ jobId });
  const edits = () =>
    runGh.mock.calls
      .filter(([args]) => args[1] === 'edit')
      .map(([args]) => args[4]);
  return { add, getJob, close, eventsClose, runGh, start, emit, edits };
}

describe('ingest regressions', () => {
  it('ignores foreign IDs and only blocks after the last attempt', async () => {
    const h = harness();
    const stop = h.start();
    try {
      await vi.waitFor(() => expect(h.edits()).toEqual(['status:queued']));
      for (const event of ['active', 'failed', 'completed'])
        h.emit(event, 'foreign');
      h.emit('failed');
      await vi.waitFor(() => expect(h.getJob).toHaveBeenCalledTimes(1));
      expect(h.edits()).toEqual(['status:queued']);
      h.getJob.mockResolvedValue({ attemptsMade: 3, opts: { attempts: 3 } });
      h.emit('failed');
      await vi.waitFor(() =>
        expect(h.edits()).toEqual(['status:queued', 'status:blocked']),
      );
    } finally {
      stop();
    }
  });
  it('serializes active behind queued when active arrives during add', async () => {
    const h = harness();
    h.add.mockImplementation(async () => {
      h.emit('active');
      return {};
    });
    const stop = h.start();
    try {
      await vi.waitFor(() =>
        expect(h.edits()).toEqual(['status:queued', 'status:in-progress']),
      );
    } finally {
      stop();
    }
  });
  it('retries queued labels with the same ID and creates labels only once', async () => {
    vi.useFakeTimers();
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const h = harness();
    const run = h.runGh.getMockImplementation()!;
    let failed = false;
    h.runGh.mockImplementation(async (args) => {
      if (args[1] === 'edit' && !failed) {
        failed = true;
        throw new Error('edit failed');
      }
      return run(args);
    });
    const stop = h.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(h.add).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.add.mock.calls.map((call) => call[2])).toEqual([
        { jobId: 'issue-12' },
        { jobId: 'issue-12' },
      ]);
      expect(
        h.runGh.mock.calls.filter(([args]) => args[0] === 'label'),
      ).toHaveLength(7);
    } finally {
      stop();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
  it('recovers from a hung poll and closes events and manager', async () => {
    vi.useFakeTimers();
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const h = harness();
    h.add.mockImplementationOnce(() => new Promise(() => undefined));
    const stop = h.start();
    try {
      await vi.advanceTimersByTimeAsync(20_001);
      expect(
        h.runGh.mock.calls.filter(([args]) => args[1] === 'list').length,
      ).toBeGreaterThan(2);
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('poll failed'),
        expect.any(Error),
      );
      stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.add).toHaveBeenCalledTimes(2);
      expect(h.edits()).toEqual(['status:queued']);
      expect(h.eventsClose).toHaveBeenCalledTimes(3);
      expect(h.close).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
  it('continues with other teams after one team fails', async () => {
    const h = harness();
    const run = h.runGh.getMockImplementation()!;
    h.runGh.mockImplementation(async (args) => {
      if (args[1] === 'list' && args[5] === 'team:frontend')
        throw new Error('team failed');
      return run(args);
    });
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const stop = h.start();
    try {
      await vi.waitFor(() => expect(h.add).toHaveBeenCalledTimes(1));
    } finally {
      stop();
      warning.mockRestore();
    }
  });
});

describe('ingest initialization', () => {
  it('retries label initialization after failure, then stops creating labels', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.runGh.mockRejectedValueOnce(new Error('label failed'));
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const stop = h.start();
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(h.add).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(h.add).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(
        h.runGh.mock.calls.filter(([args]) => args[0] === 'label'),
      ).toHaveLength(14);
    } finally {
      stop();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
  it('closes partially created resources when event construction fails', () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const eventsClose = vi.fn().mockResolvedValue(undefined);
    const queueEvents = vi
      .fn()
      .mockReturnValueOnce({ on: vi.fn(), close: eventsClose })
      .mockImplementationOnce(() => {
        throw new Error('events failed');
      });
    expect(() =>
      startIssueIngest({
        queueManager: { getQueue: vi.fn(), close },
        queueEvents,
      }),
    ).toThrow('events failed');
    expect(close).toHaveBeenCalledOnce();
    expect(eventsClose).toHaveBeenCalledOnce();
  });
});

it('keeps server startup alive when QueueManager construction fails', () => {
  vi.stubEnv('AGENT_HQ_V2_WORKERS', '1');
  const manager = vi
    .spyOn(queue, 'QueueManager')
    .mockImplementation(function () {
      throw new Error('Redis configuration failed');
    });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect(() => startConfiguredIssueIngest()).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('could not start issue ingest'),
      expect.any(Error),
    );
  } finally {
    manager.mockRestore();
    warning.mockRestore();
    vi.unstubAllEnvs();
  }
});
