import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  notificationFor,
  findNewEntries,
  requestNotificationPermission,
  showNotification,
} from './notify';
import type { HQEvent, InternalAction, State } from './server/state';

describe('notify logic (lib/notify.ts)', () => {
  const baseState: State = {
    agents: {
      claude: { status: 'idle', room: 'lounge' },
      agy: { status: 'idle', room: 'lounge' },
      codex: { status: 'idle', room: 'lounge' },
    },
    runs: {},
    activePR: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('notificationFor', () => {
    it('returns notification for TASK_FAILED with ticketId and statusText', () => {
      const event: HQEvent = {
        event: 'TASK_FAILED',
        agent: 'agy',
        room: 'dev',
        ticketId: '#19',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { statusText: 'Vitest check failed with exit code 1' },
      };

      const result = notificationFor(event, baseState);
      expect(result).toEqual({
        title: 'Task fehlgeschlagen (#19)',
        body: 'Vitest check failed with exit code 1',
      });
    });

    it('returns notification for TASK_FAILED without ticketId', () => {
      const event: HQEvent = {
        event: 'TASK_FAILED',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };

      const result = notificationFor(event, baseState);
      expect(result).toEqual({
        title: 'Task fehlgeschlagen',
        body: 'Ein Task ist fehlgeschlagen.',
      });
    });

    it('returns notification for PR_READY with PR number and title', () => {
      const event: HQEvent = {
        event: 'PR_READY',
        agent: 'claude',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {
          prNumber: 42,
          title: 'feat(#19): Chiptune-Sounds & Browser-Notifications',
        },
      };

      const result = notificationFor(event, baseState);
      expect(result).toEqual({
        title: 'PR #42 bereit zum Merge',
        body: 'feat(#19): Chiptune-Sounds & Browser-Notifications',
      });
    });

    it('reads activePR from state if event data does not have prNumber', () => {
      const event: HQEvent = {
        event: 'PR_READY',
        agent: 'claude',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      const stateWithPR: State = {
        ...baseState,
        activePR: {
          prNumber: 99,
          title: 'Ready PR in state',
        },
      };

      const result = notificationFor(event, stateWithPR);
      expect(result).toEqual({
        title: 'PR #99 bereit zum Merge',
        body: 'Der Pull Request ist bereit für den manuellen Merge.',
      });
    });

    describe('waiting for input (detectPendingInput integration)', () => {
      const promptEvent: HQEvent = {
        event: 'TASK_PROGRESS',
        agent: 'agy',
        runId: 'run-test-1',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { logChunk: 'Möchten Sie die Änderungen anwenden? [y/n]\n' },
      };

      const stateWithRunning: State = {
        ...baseState,
        runs: {
          'run-test-1': {
            runId: 'run-test-1',
            agent: 'agy',
            status: 'running',
            timestamp: '2026-10-22T20:00:00.000Z',
            data: {},
          },
        },
      };

      it('returns notification when prompt appeared >= 10s ago', () => {
        const nowMs = Date.parse('2026-10-22T20:00:15.000Z');
        const result = notificationFor(promptEvent, stateWithRunning, nowMs);

        expect(result).toEqual({
          title: 'Agent wartet auf Eingabe',
          body: 'Möchten Sie die Änderungen anwenden? [y/n]',
        });
      });

      it('returns null when prompt appeared < 10s ago', () => {
        const nowMs = Date.parse('2026-10-22T20:00:04.000Z');
        const result = notificationFor(promptEvent, stateWithRunning, nowMs);
        expect(result).toBeNull();
      });

      it('returns notification by default if timestamp was in the past or nowMs omitted', () => {
        const result = notificationFor(promptEvent, stateWithRunning);
        expect(result).toEqual({
          title: 'Agent wartet auf Eingabe',
          body: 'Möchten Sie die Änderungen anwenden? [y/n]',
        });
      });

      it('returns null if the run is completed or not running', () => {
        const stateComplete: State = {
          ...baseState,
          runs: {
            'run-test-1': {
              runId: 'run-test-1',
              agent: 'agy',
              status: 'complete',
              timestamp: '2026-10-22T20:00:00.000Z',
              data: {},
            },
          },
        };
        const nowMs = Date.parse('2026-10-22T20:00:15.000Z');
        const result = notificationFor(promptEvent, stateComplete, nowMs);
        expect(result).toBeNull();
      });

      it('returns null if TASK_PROGRESS logChunk is normal output (not a prompt)', () => {
        const logEvent: HQEvent = {
          event: 'TASK_PROGRESS',
          agent: 'agy',
          runId: 'run-test-1',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: { logChunk: 'Building project bundles...\n' },
        };
        const nowMs = Date.parse('2026-10-22T20:00:15.000Z');
        const result = notificationFor(logEvent, stateWithRunning, nowMs);
        expect(result).toBeNull();
      });
    });

    it('returns null for non-notifying events', () => {
      const nonNotifying: HQEvent['event'][] = [
        'TASK_START',
        'TASK_COMPLETE',
        'TASK_ABORTED',
        'TASK_HANDOVER',
        'DRAFT_PR_CREATED',
        'REVIEW_START',
        'CI_CHECK_PASS',
        'CI_CHECK_FAIL',
        'MERGED',
        'RATE_LIMITED',
      ];

      for (const ev of nonNotifying) {
        const item: HQEvent = {
          event: ev,
          agent: 'claude',
          room: 'lounge',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: {},
        };
        expect(notificationFor(item, baseState)).toBeNull();
      }
    });

    it('returns null for InternalAction items and invalid input', () => {
      const action: InternalAction = { type: 'ARRIVED', agent: 'claude' };
      expect(notificationFor(action, baseState)).toBeNull();
      expect(notificationFor(null, baseState)).toBeNull();
      expect(notificationFor(undefined, baseState)).toBeNull();
      expect(notificationFor({}, baseState)).toBeNull();
    });
  });

  describe('lastSeen recognition (findNewEntries)', () => {
    function createEvent(id: number): HQEvent {
      return {
        event: 'TASK_PROGRESS',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { statusText: `event-${id}` },
      };
    }

    it('returns empty array when feed is empty', () => {
      expect(findNewEntries([], null)).toEqual([]);
      expect(findNewEntries([], undefined)).toEqual([]);
    });

    it('returns empty array on initial mount / reload when isInitial: true', () => {
      const feed = [createEvent(1), createEvent(2), createEvent(3)];
      expect(findNewEntries(feed, null, { isInitial: true })).toEqual([]);
      expect(findNewEntries(feed, feed[2], { isInitial: true })).toEqual([]);
    });

    it('detects a single newly added entry', () => {
      const e1 = createEvent(1);
      const e2 = createEvent(2);
      const feed = [e1, e2];

      const newEntries = findNewEntries(feed, e1);
      expect(newEntries).toEqual([e2]);
    });

    it('detects multiple newly added entries in order', () => {
      const e1 = createEvent(1);
      const e2 = createEvent(2);
      const e3 = createEvent(3);
      const e4 = createEvent(4);
      const feed = [e1, e2, e3, e4];

      const newEntries = findNewEntries(feed, e1);
      expect(newEntries).toEqual([e2, e3, e4]);
    });

    it('returns empty array when no new entries were added (lastSeen is latest)', () => {
      const e1 = createEvent(1);
      const e2 = createEvent(2);
      const feed = [e1, e2];

      const newEntries = findNewEntries(feed, e2);
      expect(newEntries).toEqual([]);
    });

    it('correctly detects new entry when feed is at 1000 items capacity (feed.length remains constant)', () => {
      // Create initial feed with exactly 1000 entries
      const feed: HQEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        feed.push(createEvent(i));
      }
      expect(feed).toHaveLength(1000);

      // The last seen entry before the update
      const lastSeen = feed[999];
      expect(lastSeen.data.statusText).toBe('event-999');

      // New event arrives: liveStore.feed.push(e1000); while (feed.length > 1000) feed.shift();
      const newEvent = createEvent(1000);
      feed.push(newEvent);
      while (feed.length > 1000) feed.shift();

      // Feed length is STILL 1000!
      expect(feed).toHaveLength(1000);
      expect(feed[0].data.statusText).toBe('event-1');
      expect(feed[999].data.statusText).toBe('event-1000');

      // findNewEntries must detect the new entry via lastSeen, NOT feed.length!
      const detected = findNewEntries(feed, lastSeen);
      expect(detected).toHaveLength(1);
      expect(detected[0]).toBe(newEvent);
      expect(detected[0].data.statusText).toBe('event-1000');
    });

    it('detects multiple new entries arriving in a capped 1000-item feed', () => {
      const feed: HQEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        feed.push(createEvent(i));
      }
      const lastSeen = feed[999];

      // 5 new events arrive
      const newEvents = [
        createEvent(1000),
        createEvent(1001),
        createEvent(1002),
        createEvent(1003),
        createEvent(1004),
      ];
      for (const e of newEvents) {
        feed.push(e);
        while (feed.length > 1000) feed.shift();
      }

      expect(feed).toHaveLength(1000);
      const detected = findNewEntries(feed, lastSeen);
      expect(detected).toEqual(newEvents);
    });

    it('processes incoming event after INIT_STATE cleared feed to empty', () => {
      // 1. Initial state before reload
      const oldEvent = createEvent(99);
      let feed: HQEvent[] = [oldEvent];
      expect(findNewEntries(feed, oldEvent)).toEqual([]);

      // 2. INIT_STATE arrives: feed is cleared to []
      feed = [];
      let lastSeen: HQEvent | null = null; // reset on empty feed
      expect(findNewEntries(feed, lastSeen)).toEqual([]);

      // 3. First new event arrives after INIT_STATE
      const firstNew = createEvent(100);
      feed = [firstNew];

      const detected = findNewEntries(feed, lastSeen);
      expect(detected).toEqual([firstNew]);
      lastSeen = firstNew;
      expect(lastSeen).toBe(firstNew);
    });

    it('returns all items if lastSeen was evicted due to massive burst >1000 items', () => {
      const oldEvent = createEvent(0);
      const feed: HQEvent[] = [];
      for (let i = 1; i <= 1000; i++) {
        feed.push(createEvent(i));
      }

      // oldEvent is not in feed anymore
      const detected = findNewEntries(feed, oldEvent);
      expect(detected).toEqual(feed);
    });
  });

  describe('browser notification helpers', () => {
    const originalNotification = globalThis.Notification;

    beforeEach(() => {
      (globalThis as unknown as { Notification: unknown }).Notification =
        undefined;
    });

    afterEach(() => {
      (globalThis as unknown as { Notification: unknown }).Notification =
        originalNotification;
    });

    it('requestNotificationPermission returns denied if Notification API is not available', async () => {
      const result = await requestNotificationPermission();
      expect(result).toBe('denied');
    });

    it('requestNotificationPermission delegates to Notification.requestPermission', async () => {
      const requestMock = vi.fn().mockResolvedValue('granted');
      (globalThis as unknown as { Notification: unknown }).Notification = {
        permission: 'default',
        requestPermission: requestMock,
      };

      const result = await requestNotificationPermission();
      expect(result).toBe('granted');
      expect(requestMock).toHaveBeenCalled();
    });

    it('showNotification creates a Notification instance if permission is granted', () => {
      const instances: { title: string; options?: NotificationOptions }[] = [];
      class MockNotification {
        static permission = 'granted';
        constructor(title: string, options?: NotificationOptions) {
          instances.push({ title, options });
        }
      }
      (globalThis as unknown as { Notification: unknown }).Notification =
        MockNotification;

      showNotification('Test Alert', { body: 'Test body' });
      expect(instances).toHaveLength(1);
      expect(instances[0]).toEqual({
        title: 'Test Alert',
        options: { body: 'Test body' },
      });
    });

    it('showNotification returns null if permission is denied', () => {
      const instances: { title: string; options?: NotificationOptions }[] = [];
      class MockNotification {
        static permission = 'denied';
        constructor(title: string, options?: NotificationOptions) {
          instances.push({ title, options });
        }
      }
      (globalThis as unknown as { Notification: unknown }).Notification =
        MockNotification;

      const res = showNotification('Test Alert');
      expect(res).toBeNull();
      expect(instances).toHaveLength(0);
    });
  });
});
