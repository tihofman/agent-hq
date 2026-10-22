import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRunTimestamp,
  formatStatusLabel,
  formatTicket,
  getAgentBadgeClass,
  getPrInfo,
  getStatusBadgeClass,
} from './history-format';

describe('history-format', () => {
  describe('formatDuration', () => {
    it('handles zero, negative and non-finite values', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(-500)).toBe('0s');
      expect(formatDuration(NaN)).toBe('0s');
      expect(formatDuration(Infinity)).toBe('0s');
    });

    it('formats durations under 1 second', () => {
      expect(formatDuration(200)).toBe('< 1s');
      expect(formatDuration(999)).toBe('< 1s');
    });

    it('formats seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(15400)).toBe('15s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(65000)).toBe('1m 5s');
      expect(formatDuration(120000)).toBe('2m');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(3665000)).toBe('1h 1m');
      expect(formatDuration(7200000)).toBe('2h');
    });
  });

  describe('formatStatusLabel', () => {
    it('formats complete status with and without exitCode', () => {
      expect(formatStatusLabel('complete', 0)).toBe('Abgeschlossen (0)');
      expect(formatStatusLabel('complete')).toBe('Abgeschlossen');
      expect(formatStatusLabel('complete', null)).toBe('Abgeschlossen');
    });

    it('formats failed status with exitCode', () => {
      expect(formatStatusLabel('failed', 2)).toBe('Fehlgeschlagen (2)');
      expect(formatStatusLabel('failed', 1)).toBe('Fehlgeschlagen (1)');
      expect(formatStatusLabel('failed')).toBe('Fehlgeschlagen');
    });

    it('formats running, handover, aborted, cooldown, idle', () => {
      expect(formatStatusLabel('running')).toBe('Läuft');
      expect(formatStatusLabel('handover')).toBe('Übergabe');
      expect(formatStatusLabel('aborted')).toBe('Abgebrochen');
      expect(formatStatusLabel('cooldown')).toBe('Cooldown');
      expect(formatStatusLabel('idle')).toBe('Bereit');
    });

    it('passes through unknown statuses', () => {
      expect(formatStatusLabel('custom_state')).toBe('custom_state');
      expect(formatStatusLabel('custom_state', 42)).toBe('custom_state (42)');
    });
  });

  describe('getPrInfo', () => {
    it('returns null when data or prNumber is missing or not a positive integer', () => {
      expect(getPrInfo(null)).toBeNull();
      expect(getPrInfo(undefined)).toBeNull();
      expect(getPrInfo({})).toBeNull();
      expect(getPrInfo({ prNumber: 0 })).toBeNull();
      expect(getPrInfo({ prNumber: -5 })).toBeNull();
      expect(getPrInfo({ prNumber: 1.5 })).toBeNull();
    });

    it('returns label with null URL when prUrl is not provided', () => {
      // Realistic data: data.repo is just 'agent-hq' without owner, no client-side URL building
      const info = getPrInfo({ repo: 'agent-hq', prNumber: 7 });
      expect(info).toEqual({
        prNumber: 7,
        label: 'PR #7',
        url: null,
      });

      const infoWithoutRepo = getPrInfo({ prNumber: 13 });
      expect(infoWithoutRepo).toEqual({
        prNumber: 13,
        label: 'PR #13',
        url: null,
      });
    });

    it('returns label and URL when prUrl is provided via second arg or property', () => {
      const infoArg = getPrInfo(
        { repo: 'agent-hq', prNumber: 18 },
        'https://github.com/tihofman/agent-hq/pull/18',
      );
      expect(infoArg).toEqual({
        prNumber: 18,
        label: 'PR #18',
        url: 'https://github.com/tihofman/agent-hq/pull/18',
      });

      const infoProp = getPrInfo({
        prNumber: 42,
        prUrl: 'https://github.com/tihofman/agent-hq/pull/42',
      });
      expect(infoProp).toEqual({
        prNumber: 42,
        label: 'PR #42',
        url: 'https://github.com/tihofman/agent-hq/pull/42',
      });
    });
  });

  describe('formatTicket', () => {
    it('prefixes ticket number with #', () => {
      expect(formatTicket('18')).toBe('#18');
      expect(formatTicket('#18')).toBe('#18');
    });

    it('returns — for empty or undefined ticket', () => {
      expect(formatTicket(undefined)).toBe('—');
      expect(formatTicket(null)).toBe('—');
      expect(formatTicket('')).toBe('—');
      expect(formatTicket('   ')).toBe('—');
    });
  });

  describe('formatRunTimestamp', () => {
    it('formats valid ISO timestamps', () => {
      const formatted = formatRunTimestamp('2026-10-22T20:15:30.000Z');
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('returns — for invalid timestamps', () => {
      expect(formatRunTimestamp('')).toBe('—');
      expect(formatRunTimestamp('invalid-date')).toBe('—');
      expect(formatRunTimestamp(undefined)).toBe('—');
    });
  });

  describe('badges', () => {
    it('returns correct class for agents', () => {
      expect(getAgentBadgeClass('claude')).toContain('blue');
      expect(getAgentBadgeClass('agy')).toContain('fuchsia');
      expect(getAgentBadgeClass('codex')).toContain('cyan');
      expect(getAgentBadgeClass('unknown')).toContain('slate');
    });

    it('returns correct class for run status', () => {
      expect(getStatusBadgeClass('complete')).toContain('emerald');
      expect(getStatusBadgeClass('failed')).toContain('rose');
      expect(getStatusBadgeClass('aborted')).toContain('amber');
      expect(getStatusBadgeClass('running')).toContain('blue');
      expect(getStatusBadgeClass('handover')).toContain('purple');
      expect(getStatusBadgeClass('cooldown')).toContain('slate');
      expect(getStatusBadgeClass('unknown')).toContain('slate');
    });
  });
});
