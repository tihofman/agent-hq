import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  soundFor,
  isAudioEnabled,
  setAudioEnabled,
  resetAudioStateForTesting,
  setAudioContextForTesting,
  playLevelUp,
  playDoorbell,
  playBuzzer,
} from './audio';
import type { HQEvent, InternalAction } from './server/state';

class MockStorage {
  store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

describe('audio logic (lib/audio.ts)', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    resetAudioStateForTesting();
    globalThis.localStorage = new MockStorage() as unknown as Storage;
  });

  afterEach(() => {
    resetAudioStateForTesting();
    globalThis.localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  describe('soundFor', () => {
    it('returns "levelUp" for PR_READY and MERGED events', () => {
      const prReadyEvent: HQEvent = {
        event: 'PR_READY',
        agent: 'claude',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { prNumber: 42, title: 'Feature Ready' },
      };
      expect(soundFor(prReadyEvent)).toBe('levelUp');

      const mergedEvent: HQEvent = {
        event: 'MERGED',
        agent: 'claude',
        room: 'ceo',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { prNumber: 42 },
      };
      expect(soundFor(mergedEvent)).toBe('levelUp');
    });

    it('returns "doorbell" for TASK_HANDOVER events', () => {
      const handoverEvent: HQEvent = {
        event: 'TASK_HANDOVER',
        agent: 'claude',
        room: 'hall',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { title: 'Delegate Ticket #19' },
      };
      expect(soundFor(handoverEvent)).toBe('doorbell');
    });

    it('returns "buzzer" for TASK_FAILED and CI_CHECK_FAIL events', () => {
      const taskFailedEvent: HQEvent = {
        event: 'TASK_FAILED',
        agent: 'agy',
        room: 'dev',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: { statusText: 'Tests failed' },
      };
      expect(soundFor(taskFailedEvent)).toBe('buzzer');

      const ciFailEvent: HQEvent = {
        event: 'CI_CHECK_FAIL',
        agent: 'codex',
        room: 'qa',
        timestamp: '2026-10-22T20:00:00.000Z',
        data: {},
      };
      expect(soundFor(ciFailEvent)).toBe('buzzer');
    });

    it('returns null for other events without audio alert', () => {
      const events: HQEvent['event'][] = [
        'TASK_START',
        'TASK_PROGRESS',
        'TASK_COMPLETE',
        'TASK_ABORTED',
        'DRAFT_PR_CREATED',
        'REVIEW_START',
        'CI_CHECK_PASS',
        'RATE_LIMITED',
      ];

      for (const ev of events) {
        const item: HQEvent = {
          event: ev,
          agent: 'agy',
          room: 'dev',
          timestamp: '2026-10-22T20:00:00.000Z',
          data: {},
        };
        expect(soundFor(item)).toBeNull();
      }
    });

    it('returns null for InternalAction items', () => {
      const action: InternalAction = {
        type: 'ARRIVED',
        agent: 'claude',
      };
      expect(soundFor(action)).toBeNull();

      const tickAction: InternalAction = {
        type: 'TICK',
        timestamp: '2026-10-22T20:00:00.000Z',
      };
      expect(soundFor(tickAction)).toBeNull();
    });

    it('returns null for null, undefined, or empty/malformed values', () => {
      expect(soundFor(null)).toBeNull();
      expect(soundFor(undefined)).toBeNull();
      expect(soundFor({})).toBeNull();
      expect(soundFor('not-an-event')).toBeNull();
      expect(soundFor(123)).toBeNull();
    });
  });

  describe('isAudioEnabled and setAudioEnabled', () => {
    it('defaults to false (muted)', () => {
      expect(isAudioEnabled()).toBe(false);
    });

    it('persists enabled state to localStorage', () => {
      setAudioEnabled(true);
      expect(isAudioEnabled()).toBe(true);
      expect(localStorage.getItem('agent-hq:audio')).toBe('true');

      setAudioEnabled(false);
      expect(isAudioEnabled()).toBe(false);
      expect(localStorage.getItem('agent-hq:audio')).toBe('false');
    });

    it('handles localStorage errors gracefully without throwing', () => {
      const mockStorage = {
        getItem: vi.fn(() => {
          throw new Error('Access denied');
        }),
        setItem: vi.fn(() => {
          throw new Error('Quota exceeded');
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
      globalThis.localStorage = mockStorage as unknown as Storage;

      expect(isAudioEnabled()).toBe(false);
      expect(() => setAudioEnabled(true)).not.toThrow();
    });
  });

  describe('WebAudio sound synthesis', () => {
    function createMockAudioContext(state: AudioContextState = 'running') {
      const createdOscillators: {
        type: OscillatorType;
        frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        connect: ReturnType<typeof vi.fn>;
      }[] = [];

      const createdGains: {
        gain: {
          setValueAtTime: ReturnType<typeof vi.fn>;
          linearRampToValueAtTime: ReturnType<typeof vi.fn>;
          exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
        };
        connect: ReturnType<typeof vi.fn>;
      }[] = [];

      const resumeMock = vi.fn().mockResolvedValue(undefined);

      const mockCtx = {
        currentTime: 10.0,
        state,
        destination: {} as AudioDestinationNode,
        resume: resumeMock,
        createOscillator: vi.fn(() => {
          const osc = {
            type: 'sine' as OscillatorType,
            frequency: { setValueAtTime: vi.fn() },
            start: vi.fn(),
            stop: vi.fn(),
            connect: vi.fn(),
          };
          createdOscillators.push(osc);
          return osc as unknown as OscillatorNode;
        }),
        createGain: vi.fn(() => {
          const gainNode = {
            gain: {
              setValueAtTime: vi.fn(),
              linearRampToValueAtTime: vi.fn(),
              exponentialRampToValueAtTime: vi.fn(),
            },
            connect: vi.fn(),
          };
          createdGains.push(gainNode);
          return gainNode as unknown as GainNode;
        }),
      } as unknown as AudioContext;

      return { mockCtx, createdOscillators, createdGains, resumeMock };
    }

    it('synthesizes square-wave arpeggio for playLevelUp', () => {
      const { mockCtx, createdOscillators } = createMockAudioContext();
      setAudioContextForTesting(mockCtx);

      playLevelUp();

      expect(createdOscillators.length).toBe(4);
      for (const osc of createdOscillators) {
        expect(osc.type).toBe('square');
        expect(osc.start).toHaveBeenCalled();
        expect(osc.stop).toHaveBeenCalled();
      }
    });

    it('synthesizes triangle chime for playDoorbell', () => {
      const { mockCtx, createdOscillators } = createMockAudioContext();
      setAudioContextForTesting(mockCtx);

      playDoorbell();

      expect(createdOscillators.length).toBe(2);
      for (const osc of createdOscillators) {
        expect(osc.type).toBe('triangle');
        expect(osc.start).toHaveBeenCalled();
        expect(osc.stop).toHaveBeenCalled();
      }
    });

    it('synthesizes sawtooth buzz for playBuzzer', () => {
      const { mockCtx, createdOscillators } = createMockAudioContext();
      setAudioContextForTesting(mockCtx);

      playBuzzer();

      expect(createdOscillators.length).toBe(2);
      for (const osc of createdOscillators) {
        expect(osc.type).toBe('sawtooth');
        expect(osc.start).toHaveBeenCalled();
        expect(osc.stop).toHaveBeenCalled();
      }
    });

    it('resumes audio context if suspended', () => {
      const { mockCtx, resumeMock } = createMockAudioContext('suspended');
      setAudioContextForTesting(mockCtx);

      playLevelUp();

      expect(resumeMock).toHaveBeenCalled();
    });

    it('is safe if AudioContext is not available (e.g. headless SSR)', () => {
      setAudioContextForTesting(null);
      expect(() => playLevelUp()).not.toThrow();
      expect(() => playDoorbell()).not.toThrow();
      expect(() => playBuzzer()).not.toThrow();
    });
  });
});
