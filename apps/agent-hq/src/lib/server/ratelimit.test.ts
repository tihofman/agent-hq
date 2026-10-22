import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRateLimit } from './ratelimit';

const now = new Date('2026-10-22T12:00:00Z');
const expected: Record<string, string | undefined> = {
  'codex-unknown': undefined,
  'claude-model': undefined,
  'gemini-compound': '2026-10-22T14:27:18.000Z',
  'codex-clock': new Date(
    2026,
    9,
    new Date(2026, 9, 22, 13, 30) > now ? 22 : 23,
    13,
    30,
  ).toISOString(),
  'codex-date': new Date(2026, 9, 23, 13, 30).toISOString(),
  'agy-quota': undefined,
  'gemini-daily': undefined,
  'gemini-reset': '2026-10-22T12:00:42.000Z',
  'claude-clock': '2026-10-23T11:30:00.000Z',
  'claude-date': '2026-10-25T14:00:00.000Z',
  'claude-progress': '2026-10-25T14:00:00.000Z',
  'claude-fast': '2026-10-22T12:15:00.000Z',
  'claude-monthly-spend': undefined,
  'claude-credits': '2026-10-25T14:00:00.000Z',
  'api-retry-after': '2026-10-22T12:01:00.000Z',
};
const dir = join(import.meta.dirname, '__fixtures__/ratelimit');
describe('detectRateLimit', () => {
  it.each(readdirSync(dir))('recognizes fixture %s', (file) => {
    const [source, ...lines] = readFileSync(join(dir, file), 'utf8')
      .trimEnd()
      .split('\n');
    expect(source).toMatch(/^# (Verified|Derived)/);
    expect(Object.hasOwn(expected, file.slice(0, -4))).toBe(true);
    const until = expected[file.slice(0, -4)];
    expect(detectRateLimit(lines.join('\n'), now)).toEqual(
      until ? { cooldownUntil: until } : {},
    );
  });
  it.each([
    'The rate of requests is normal',
    'Set the limit to 100',
    'Please handle rate limit exceeded errors',
    '> You have exhausted your quota on this model.',
    'user: You’ve hit your usage limit.',
    '{"type":"message","role":"user","content":"You’ve hit your usage limit."}',
    'codex exec "You’ve hit your usage limit."',
    'Rate limit handling implemented',
    'Rate limit exceeded errors are now retried with backoff.',
    'Limit reached checks added to tail.ts',
    '429 quota tests pass',
    'You have exhausted your quota on this model. (fixture added)',
    'Limit reached. Added a test.',
    "You've hit your fast limit checks added",
  ])('ignores prose and prompts: %s', (line) => {
    expect(detectRateLimit(line, now)).toBeNull();
  });
  it.each([
    ['2026-12-31T12:00:00Z', 'Jan 2, 3pm', '2027-01-02T14:00:00.000Z'],
    ['2026-10-26T12:00:00Z', 'Oct 25, 3pm', '2027-10-25T13:00:00.000Z'],
  ])(
    'rolls dated resets to the next year when needed: %s',
    (at, reset, until) => {
      expect(
        detectRateLimit(
          `You've hit your limit · resets ${reset} (Europe/Berlin)`,
          new Date(at),
        ),
      ).toEqual({ cooldownUntil: until });
    },
  );
  it('accepts structured errors but not embedded prompt messages', () => {
    expect(
      detectRateLimit(
        '{"error":{"message":"Rate limit exceeded. Retry-After: 2"}}',
        now,
      ),
    ).toEqual({ cooldownUntil: '2026-10-22T12:00:02.000Z' });
  });
  it('strips terminal escapes, rolls clocks to tomorrow and rejects invalid times', () => {
    expect(
      detectRateLimit(
        "\x1b[31mYou've hit your limit · resets 1am (UTC)\x1b[0m",
        now,
      ),
    ).toEqual({ cooldownUntil: '2026-10-23T01:00:00.000Z' });
    expect(
      detectRateLimit("You've hit your limit · resets 25:99", now),
    ).toEqual({});
    expect(
      detectRateLimit("You've hit your limit · resets someday", now),
    ).toEqual({});
  });
});
