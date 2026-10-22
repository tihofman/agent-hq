import { stripVTControlCharacters } from 'node:util';

/** Only CLI diagnostics, never arbitrary prose or echoed prompts. */
export function detectRateLimit(
  line: string,
  now: Date,
): { cooldownUntil?: string } | null {
  let text = stripVTControlCharacters(line).trim();
  if (text.startsWith('{')) {
    try {
      const value = JSON.parse(text);
      const error = value.error ?? (value.type === 'error' ? value : undefined);
      if (!error || typeof error.message !== 'string') return null;
      text = error.message;
    } catch {
      return null;
    }
  }
  text = text.replace(
    /^(?:[✕!⎿]\s*|\[API Error:\s*|(?:API Error|ERROR|Error|TerminalQuotaError|RetryableQuotaError):\s*|Attempt \d+ failed:\s*)+/i,
    '',
  );
  if (
    !/^(?:You['’]ve hit your (?:(?:weekly|usage(?: credit)?|session|Opus|Sonnet|Fable) )?limit\b|You have exhausted your (?:daily quota|quota|capacity) on this model\b|You exceeded your current quota\b|(?:Rate limit (?:reached|exceeded)|Limit reached)\b|rate_limit_error\b|429\b.*(?:rate_limit_error|quota|rate limit)|Your workspace (?:is out of credits|has reached its usage limit)\b)/i.test(
      text,
    )
  )
    return null;

  const relative = text.match(
    /(?:retry[- ]after\s*:\s*|(?:retry|try again|resets?)\s+in\s+|reset after\s+)((?:\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s*)+|\d+(?:\.\d+)?)(?!\w)/i,
  );
  if (relative) {
    let ms = 0;
    for (const part of relative[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)?/gi)) {
      const unit = part[2]?.toLowerCase() ?? 's';
      ms +=
        Number(part[1]) *
        (unit.startsWith('h') ? 3600000 : unit.startsWith('m') ? 60000 : 1000);
    }
    const until = new Date(now.getTime() + ms);
    return Number.isFinite(until.getTime())
      ? { cooldownUntil: until.toISOString() }
      : {};
  }
  const absolute = text
    .match(/(?:resets?(?: at)?|try again at)\s+(.+?)\s*$/i)?.[1]
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[.\]]+$/, '')
    .trim();
  if (absolute) {
    const clock = absolute.match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\)|\s+(UTC|GMT|Z))?$/i,
    );
    let until: Date;
    if (clock) {
      let hour = Number(clock[1]);
      const minute = Number(clock[2] ?? 0);
      if (
        minute > 59 ||
        hour > (clock[3] ? 12 : 23) ||
        (clock[3] && hour === 0)
      )
        return {};
      if (clock[3]) hour = (hour % 12) + (/pm/i.test(clock[3]) ? 12 : 0);
      const zone = clock[4] ?? clock[5];
      if (zone) {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: zone === 'Z' ? 'UTC' : zone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          });
          const fields = Object.fromEntries(
            parts.formatToParts(now).map((p) => [p.type, p.value]),
          );
          const target = Date.UTC(
            +fields.year,
            +fields.month - 1,
            +fields.day,
            hour,
            minute,
          );
          let epoch = target;
          for (let i = 0; i < 3; i++) {
            const f = Object.fromEntries(
              parts
                .formatToParts(new Date(epoch))
                .map((p) => [p.type, p.value]),
            );
            epoch +=
              target -
              Date.UTC(
                +f.year,
                +f.month - 1,
                +f.day,
                +f.hour,
                +f.minute,
                +f.second,
              );
          }
          until = new Date(epoch);
        } catch {
          return {};
        }
      } else {
        until = new Date(now);
        until.setHours(hour, minute, 0, 0);
      }
      if (until.getTime() <= now.getTime()) until.setDate(until.getDate() + 1);
    } else {
      // Date.parse handles ISO timestamps and Codex's "Oct 23, 2026 1:30 PM".
      until = new Date(absolute);
    }
    if (Number.isFinite(until.getTime()))
      return { cooldownUntil: until.toISOString() };
  }
  return {};
}
