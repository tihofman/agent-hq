import { describe, it, expect } from 'vitest';
import {
  initialState,
  parseEvent,
  reduce,
  type EventType,
  type State,
} from './state';

const timestamp = '2026-10-22T16:40:00.000Z';
const event = (type: EventType, extra = {}) =>
  parseEvent(
    { event: type, agent: 'codex', runId: 'run-1', ...extra },
    () => timestamp,
  );
const apply = (state: State, type: EventType, extra = {}) =>
  reduce(state, event(type, extra));
const coding = () => apply(initialState, 'TASK_START');

describe('parseEvent', () => {
  it.each([
    ['TASK_HANDOVER', 'hall'],
    ['TASK_START', 'dev'],
    ['TASK_PROGRESS', 'dev'],
    ['TASK_COMPLETE', 'dev'],
    ['TASK_FAILED', 'dev'],
    ['TASK_ABORTED', 'lounge'],
    ['RUN_STALE', 'lounge'],
    ['DRAFT_PR_CREATED', 'qa'],
    ['REVIEW_START', 'qa'],
    ['PR_READY', 'qa'],
    ['CI_CHECK_PASS', 'qa'],
    ['CI_CHECK_FAIL', 'qa'],
    ['MERGED', 'ceo'],
    ['PR_CLOSED', 'lounge'],
    ['RATE_LIMITED', 'lounge'],
    ['SUBSCRIPTION_FAILOVER', 'lounge'],
  ] as const)('accepts %s and derives %s', (type, room) => {
    expect(event(type)).toMatchObject({ event: type, room, timestamp });
  });
  it('preserves explicit room and timestamp without consulting the clock', () => {
    expect(
      parseEvent(
        { event: 'REVIEW_START', agent: 'claude', room: 'ceo', timestamp },
        () => {
          throw Error('clock');
        },
      ),
    ).toMatchObject({ room: 'ceo', timestamp });
  });
  it('accepts the runner’s null PID and exit code', () => {
    expect(
      event('TASK_HANDOVER', {
        pid: null,
        ticketId: '',
        data: { exitCode: null },
      }).pid,
    ).toBeNull();
  });
  it.each<[unknown, string]>([
    [null, 'object'],
    [[], 'object'],
    [{}, 'event'],
    [{ event: 'NOPE' }, 'event'],
    [{ event: 'TASK_START', agent: 'other' }, 'agent'],
    ...Object.entries({
      room: 'office',
      timestamp: 'yesterday',
      runId: '',
      pid: -1,
      cwd: 42,
      ticketId: 12,
      data: [],
    }).map(([key, value]): [unknown, string] => [
      { event: 'TASK_START', agent: 'codex', [key]: value },
      key,
    ]),
    ...Object.entries({
      title: 1,
      statusText: false,
      logFile: 5,
      logChunk: {},
      exitCode: 1.2,
      prNumber: 0,
      criteriaTotal: -1,
      criteriaCompleted: NaN,
      cooldownUntil: 'later',
      repo: 1,
      branch: false,
    }).map(([key, value]): [unknown, string] => [
      { event: 'TASK_START', agent: 'codex', data: { [key]: value } },
      `data.${key}`,
    ]),
  ])('rejects malformed input %#', (input, field) => {
    expect(() => parseEvent(input)).toThrow(String(field));
  });
  it('copies only validated fields', () => {
    const input = {
      event: 'TASK_PROGRESS',
      agent: 'agy',
      data: { logChunk: 'hello', extra: BigInt(1) },
      extra: BigInt(1),
    };
    const parsed = parseEvent(input);
    input.data.logChunk = 'changed';
    expect(parsed.data.logChunk).toBe('hello');
    expect(() => JSON.stringify(parsed)).not.toThrow();
  });
  it('validates and preserves optional repo and branch in data', () => {
    const parsed = parseEvent({
      event: 'TASK_START',
      agent: 'agy',
      data: { repo: 'agent-hq', branch: 'feat/13-repo-branch' },
    });
    expect(parsed.data.repo).toBe('agent-hq');
    expect(parsed.data.branch).toBe('feat/13-repo-branch');
  });
  it('validates SUBSCRIPTION_FAILOVER event data and puts source agent into cooldown', () => {
    const parsed = parseEvent(
      {
        event: 'SUBSCRIPTION_FAILOVER',
        data: {
          team: 'frontend',
          from: 'agy',
          to: 'claude',
          cooldownUntil: '2026-10-22T17:00:00.000Z',
        },
      },
      () => timestamp,
    );
    expect(parsed).toMatchObject({
      event: 'SUBSCRIPTION_FAILOVER',
      agent: 'agy',
      room: 'lounge',
      timestamp,
      data: {
        team: 'frontend',
        from: 'agy',
        to: 'claude',
        cooldownUntil: '2026-10-22T17:00:00.000Z',
      },
    });
    const next = reduce(initialState, parsed);
    expect(next.agents.agy).toEqual({
      status: 'cooldown',
      room: 'lounge',
      cooldownUntil: '2026-10-22T17:00:00.000Z',
    });
  });
});

describe('reduce', () => {
  it('starts idle in the lounge', () => {
    for (const agent of Object.values(initialState.agents))
      expect(agent).toMatchObject({ status: 'idle', room: 'lounge' });
  });
  it('walks, arrives, and starts coding', () => {
    const walking = apply(initialState, 'TASK_HANDOVER');
    expect(walking.agents.codex.status).toBe('walking');
    const handover = reduce(walking, { type: 'ARRIVED', agent: 'codex' });
    expect(handover.agents.codex.status).toBe('handover');
    expect(apply(handover, 'TASK_START').agents.codex.status).toBe('coding');
  });
  it('enters testing and returns to coding', () => {
    const testing = reduce(coding(), { type: 'TEST_STARTED', agent: 'codex' });
    expect(testing.agents.codex.status).toBe('testing');
    expect(
      reduce(testing, { type: 'TEST_FINISHED', agent: 'codex' }).agents.codex
        .status,
    ).toBe('coding');
  });
  it.each(['DRAFT_PR_CREATED', 'REVIEW_START'] as const)(
    '%s starts review; remediation resumes coding',
    (type) => {
      const reviewing = apply(coding(), type, {
        data: { prNumber: 34, criteriaTotal: 4, criteriaCompleted: 3 },
      });
      expect(reviewing.agents.codex.status).toBe('reviewing');
      expect(reviewing.activePR).toMatchObject({
        prNumber: 34,
        criteriaTotal: 4,
        criteriaCompleted: 3,
      });
      expect(apply(reviewing, 'TASK_START').agents.codex.status).toBe('coding');
    },
  );
  it.each(['PR_READY', 'MERGED', 'PR_CLOSED'] as const)(
    '%s returns reviewing agent to idle',
    (type) => {
      const state = apply(apply(coding(), 'REVIEW_START'), type);
      expect(state.agents.codex.status).toBe('idle');
      expect(state.activePR?.status).toBe(
        type === 'MERGED'
          ? 'merged'
          : type === 'PR_CLOSED'
            ? 'closed'
            : 'ready',
      );
    },
  );
  it('overwrites activePR when PR_CLOSED arrives for a different PR number', () => {
    const reviewing = apply(coding(), 'REVIEW_START', {
      data: { prNumber: 42, title: 'Old PR', ci: 'pass' },
    });
    expect(reviewing.activePR).toMatchObject({
      prNumber: 42,
      status: 'reviewing',
    });
    const closed = apply(reviewing, 'PR_CLOSED', {
      data: { prNumber: 74 },
    });
    expect(closed.agents.codex.status).toBe('idle');
    expect(closed.activePR).toEqual({
      prNumber: 74,
      status: 'closed',
    });
  });
  it('enters error alert and dismisses it', () => {
    const failed = apply(coding(), 'TASK_FAILED', { data: { exitCode: 1 } });
    expect(failed.agents.codex.status).toBe('errorAlert');
    expect(
      reduce(failed, { type: 'DISMISS_ERROR', agent: 'codex' }).agents.codex
        .status,
    ).toBe('idle');
  });
  it('expires cooldown using supplied time only', () => {
    const state = apply(coding(), 'RATE_LIMITED', {
      data: { cooldownUntil: '2026-10-22T17:00:00.000Z' },
    });
    expect(state.agents.codex.status).toBe('cooldown');
    expect(reduce(state, { type: 'TICK', timestamp }).agents.codex.status).toBe(
      'cooldown',
    );
    expect(
      reduce(state, { type: 'TICK', timestamp: '2026-10-22T17:00:00.000Z' })
        .agents.codex,
    ).toMatchObject({ status: 'idle', room: 'lounge' });
  });
  it('ends an elapsed cooldown on progress of the same run', () => {
    const limited = apply(coding(), 'RATE_LIMITED', {
      data: { cooldownUntil: '2026-10-22T17:00:00.000Z' },
    });
    const early = apply(limited, 'TASK_PROGRESS');
    expect(early.agents.codex.status).toBe('cooldown');
    expect(early.runs['run-1'].status).toBe('cooldown');
    const late = { timestamp: '2026-10-22T17:00:01.000Z' };
    const resumed = apply(limited, 'TASK_PROGRESS', late);
    expect(resumed.agents.codex).toMatchObject({
      status: 'coding',
      room: 'dev',
    });
    expect(resumed.agents.codex.cooldownUntil).toBeUndefined();
    expect(resumed.runs['run-1'].status).toBe('running');
    const expired = reduce(limited, { type: 'TICK', ...late });
    expect(apply(expired, 'TASK_PROGRESS', late).agents.codex.status).toBe(
      'coding',
    );
  });
  it('ends an open-ended cooldown on progress', () => {
    const limited = apply(coding(), 'RATE_LIMITED');
    const resumed = apply(limited, 'TASK_PROGRESS');
    expect(resumed.agents.codex.status).toBe('coding');
    expect(resumed.runs['run-1'].status).toBe('running');
  });
  it('keeps aborted runs and agents intact after a late failure', () => {
    const aborted = apply(coding(), 'TASK_ABORTED');
    expect(aborted.agents.codex.status).toBe('idle');
    expect(apply(aborted, 'TASK_FAILED', { data: { exitCode: 143 } })).toEqual(
      aborted,
    );
  });
  it('does not let an old run failure overwrite a newer active run', () => {
    const state = apply(coding(), 'TASK_START', { runId: 'run-2' });
    const result = apply(state, 'TASK_FAILED');
    expect(result.agents.codex).toEqual(state.agents.codex);
    expect(result.runs['run-1'].status).toBe('failed');
  });
  it('marks run as stale on RUN_STALE and moves agent to idle in lounge only if it is the current run', () => {
    const active = apply(coding(), 'RATE_LIMITED', {
      data: { cooldownUntil: '2026-10-22T17:00:00.000Z' },
    });
    const stale = apply(active, 'RUN_STALE');
    expect(stale.runs['run-1'].status).toBe('stale');
    expect(stale.agents.codex).toEqual({
      status: 'idle',
      room: 'lounge',
      runId: 'run-1',
    });

    const movedOn = apply(coding(), 'TASK_START', { runId: 'run-2' });
    const oldStale = apply(movedOn, 'RUN_STALE');
    expect(oldStale.runs['run-1'].status).toBe('stale');
    expect(oldStale.runs['run-2'].status).toBe('running');
    expect(oldStale.agents.codex).toEqual(movedOn.agents.codex);
  });
  it('merges run metadata without mutating prior snapshots', () => {
    const start = apply(initialState, 'TASK_START', {
      pid: 4243,
      ticketId: '12',
      cwd: '/repo',
      data: { logFile: '/tmp/run.log', title: 'Task' },
    });
    const before = JSON.stringify(start);
    const done = apply(start, 'TASK_COMPLETE', { data: { exitCode: 0 } });
    expect(done.runs['run-1']).toMatchObject({
      pid: 4243,
      ticketId: '12',
      cwd: '/repo',
      logFile: '/tmp/run.log',
      exitCode: 0,
      status: 'complete',
    });
    expect(JSON.stringify(start)).toBe(before);
    expect(JSON.parse(JSON.stringify(done))).toEqual(done);
    expect(initialState.runs).toEqual({});
  });
  it('preserves progress and CI results', () => {
    const progress = apply(coding(), 'TASK_PROGRESS', {
      data: { statusText: 'Compiling', logChunk: 'output' },
    });
    expect(progress.agents.codex.status).toBe('coding');
    expect(progress.runs['run-1'].data.logChunk).toBe('output');
    const failed = apply(progress, 'CI_CHECK_FAIL', { data: { prNumber: 34 } });
    expect(failed.activePR?.ci).toBe('fail');
    expect(apply(failed, 'CI_CHECK_PASS').activePR?.ci).toBe('pass');
  });
  it('merges and preserves repo and branch in run data', () => {
    const started = apply(initialState, 'TASK_START', {
      data: { repo: 'agent-hq', branch: 'feat/13-repo-branch' },
    });
    expect(started.runs['run-1'].data.repo).toBe('agent-hq');
    expect(started.runs['run-1'].data.branch).toBe('feat/13-repo-branch');

    const progressed = reduce(
      started,
      event('TASK_PROGRESS', { data: { statusText: 'Building' } }),
    );
    expect(progressed.runs['run-1'].data.repo).toBe('agent-hq');
    expect(progressed.runs['run-1'].data.branch).toBe('feat/13-repo-branch');
    expect(progressed.runs['run-1'].data.statusText).toBe('Building');
  });
});
