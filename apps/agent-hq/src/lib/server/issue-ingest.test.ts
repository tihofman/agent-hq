import { describe, expect, it, vi } from 'vitest';
import type { QueueEvents } from 'bullmq';
import { startIssueIngest } from './issue-ingest';

describe('issue ingest', () => {
  it('routes once and skips any issue already carrying a status label', async () => {
    const add = vi.fn().mockResolvedValue({});
    const queueManager = { getQueue: vi.fn(() => ({ add })) };
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
    expect(add).toHaveBeenCalledWith(
      'Build API',
      expect.objectContaining({ issueId: 12, team: 'backend' }),
      { jobId: '12' },
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
      queueManager: { getQueue: vi.fn() },
      runGh,
      queueEvents: eventsFor as never,
    });
    await vi.waitFor(() =>
      expect(runGh).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'list']),
      ),
    );
    runGh.mockClear();
    listeners.get('active')?.({ jobId: '14' });
    listeners.get('failed')?.({ jobId: '14' });
    listeners.get('completed')?.({ jobId: '14' });
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
      queueManager: { getQueue: vi.fn() },
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
