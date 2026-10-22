import { stripVTControlCharacters } from 'node:util';

const diagnostics = [
  {
    cli: 'claude/codex',
    pattern:
      /^You['’]ve hit your (?:(?:weekly|usage(?: credit)?|session|Opus|Sonnet|Fable|fast|monthly spend) )?limit/i,
  },
  { cli: 'claude', pattern: /^You['’]re out of usage credits/i },
  {
    cli: 'gemini/agy',
    pattern:
      /^You have exhausted your (?:daily quota|quota|capacity) on this model/i,
  },
  { cli: 'api', pattern: /^You exceeded your current quota/i },
  { cli: 'api', pattern: /^Rate limit (?:reached|exceeded)/i },
  { cli: 'api', pattern: /^rate_limit_error/i },
  { cli: 'api', pattern: /^429\b.*?rate_limit_error/i },
  {
    cli: 'codex',
    pattern:
      /^Your workspace (?:is out of credits|has reached its usage limit)/i,
  },
  { cli: 'codex', pattern: /^Limit reached$/i },
];

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
  const diagnostic = diagnostics.find(({ pattern }) => {
    const match = text.match(pattern);
    return (
      match &&
      /^(?:\s*(?:[.!](?!\s*\()|[·:]|Retry\b|Try\b|resets?\b)|\s*$)/i.test(
        text.slice(match[0].length),
      )
    );
  });
  if (!diagnostic) return null;

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
    .match(/(?:resets?(?: at)?|try again at)\s+(.+?)(?: \u00b7 |$)/i)?.[1]
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[.\]]+$/, '')
    .trim();
  if (absolute) {
    const dated = absolute.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (?:([0-9]{4}), )?/i,
    );
    const clock = absolute
      .slice(dated?.[0].length ?? 0)
      .match(
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
          let year = dated?.[3] ? +dated[3] : +fields.year;
          const month = dated
            ? 'jan feb mar apr may jun jul aug sep oct nov dec'
                .split(' ')
                .indexOf(dated[1].toLowerCase())
            : +fields.month - 1;
          const day = dated ? +dated[2] : +fields.day;
          let epoch = 0;
          for (let attempt = 0; attempt < 2; attempt++, year++) {
            const target = Date.UTC(year, month, day, hour, minute);
            epoch = target;
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
            if (!dated || dated[3] || epoch > now.getTime()) break;
          }
          until = new Date(epoch);
        } catch {
          return {};
        }
      } else {
        until = new Date(now);
        if (dated) {
          const month = 'jan feb mar apr may jun jul aug sep oct nov dec'
            .split(' ')
            .indexOf(dated[1].toLowerCase());
          until.setFullYear(
            dated[3] ? +dated[3] : now.getFullYear(),
            month,
            +dated[2],
          );
        }
        until.setHours(hour, minute, 0, 0);
        if (dated && !dated[3] && until.getTime() <= now.getTime())
          until.setFullYear(until.getFullYear() + 1);
      }
      if (!dated && until.getTime() <= now.getTime())
        until.setDate(until.getDate() + 1);
    } else {
      // Date.parse handles ISO timestamps and Codex's "Oct 23, 2026 1:30 PM".
      until = new Date(absolute);
    }
    if (Number.isFinite(until.getTime()))
      return { cooldownUntil: until.toISOString() };
  }
  return {};
}
