import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseCriteria,
  fetchTicket,
  clearTicketCache,
  TicketNotFoundError,
  GitHubCliError,
  type ExecFileFunction,
} from './ticket';

describe('ticket.ts', () => {
  beforeEach(() => {
    clearTicketCache();
    vi.restoreAllMocks();
  });

  describe('parseCriteria', () => {
    it('returns empty array when input is empty or invalid', () => {
      expect(parseCriteria('')).toEqual([]);
      expect(parseCriteria('   ')).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCriteria(null as any)).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCriteria(undefined as any)).toEqual([]);
    });

    it('returns empty array when no Akzeptanzkriterien section exists', () => {
      const body = `
## Kurzbeschreibung
Ein Ticket ohne Kriterien.

## Ziel
Etwas erreichen.
`;
      expect(parseCriteria(body)).toEqual([]);
    });

    it('parses unchecked and checked criteria with case-insensitive x', () => {
      const body = `
## Akzeptanzkriterien
- [ ] Erstes Kriterium
- [x] Zweites Kriterium erledigt
- [X] Drittes Kriterium mit großem X
`;
      const criteria = parseCriteria(body);
      expect(criteria).toEqual([
        { text: 'Erstes Kriterium', done: false },
        { text: 'Zweites Kriterium erledigt', done: true },
        { text: 'Drittes Kriterium mit großem X', done: true },
      ]);
    });

    it('stops parsing at the next ## heading and ignores subsequent section checklists', () => {
      const body = `
## Ziel
Zielbeschreibung

## Akzeptanzkriterien
- [ ] Kriterium 1
- [x] Kriterium 2

## Folgeabschnitt
- [ ] Checkliste im Folgeabschnitt darf NICHT geparst werden
- [x] Ebenfalls ignorieren

## Noch ein Abschnitt
- [ ] Auch ignorieren
`;
      const criteria = parseCriteria(body);
      expect(criteria).toEqual([
        { text: 'Kriterium 1', done: false },
        { text: 'Kriterium 2', done: true },
      ]);
    });

    it('handles indentation, trims text and ignores non-checkbox lines', () => {
      const body = `
## Akzeptanzkriterien
Dies ist eine einleitende Notiz.

  - [ ]   Eingerücktes Kriterium mit Leerzeichen   
- Normaler Aufzählungspunkt ohne Checkbox
  - [x]   Zweites eingerücktes Kriterium   

Etwas Text am Ende.
`;
      const criteria = parseCriteria(body);
      expect(criteria).toEqual([
        { text: 'Eingerücktes Kriterium mit Leerzeichen', done: false },
        { text: 'Zweites eingerücktes Kriterium', done: true },
      ]);
    });

    it('parses real repo issue #15 format', () => {
      const issue15Body = `
## Kurzbeschreibung
Untere Leiste zeigt das aktuelle Ticket mit seinen Akzeptanzkriterien als Checkliste und den PR-Status.

## Bearbeiter-Empfehlung & Agent-Zuweisung
**\`agent:agy\`** – UI-Komponente plus Checklisten-Parser und gh-Anbindung – Standard-Implementierung.

## Hintergrund
Siehe [PROJECT_PLAN.md](https://github.com/tihofman/agent-hq/blob/main/PROJECT_PLAN.md) Abschnitt 5.4. Quelle der Kriterien ist die \`- [ ]\`-Checkliste im GitHub-Issue (wie in diesem Ticket). Claude hakt Kriterien beim Review im Issue ab; der Tracker liest sie per \`gh issue view <id> --json title,body\`.

**Abhängig von:** #5, #8

## Ziel
Fortschritt gegen die Definition of Done ist jederzeit sichtbar.

## Akzeptanzkriterien
- [ ] \`TicketCard.svelte\` zeigt Titel, Nummer und alle Kriterien des aktuellen Tickets
- [ ] Kriterien werden aus dem Abschnitt „Akzeptanzkriterien“ des Issue-Bodys geparst (\`- [ ]\` / \`- [x]\`)
- [ ] Neu laden bei \`TASK_HANDOVER\`, \`REVIEW_START\`, \`PR_READY\` und \`MERGED\`, kein Dauer-Polling
- [ ] PR-Badge \`Draft\` → \`Ready\` → \`Merged\` sowie CI-Status (\`CI_CHECK_PASS\`/\`FAIL\`)
- [ ] \`gh\` nicht verfügbar oder Issue nicht gefunden: verständlicher Hinweis statt Fehler
- [ ] Unit-Tests für den Checklisten-Parser
`;
      const criteria = parseCriteria(issue15Body);
      expect(criteria).toHaveLength(6);
      expect(criteria[0]).toEqual({
        text: '`TicketCard.svelte` zeigt Titel, Nummer und alle Kriterien des aktuellen Tickets',
        done: false,
      });
      expect(criteria[1]).toEqual({
        text: 'Kriterien werden aus dem Abschnitt „Akzeptanzkriterien“ des Issue-Bodys geparst (`- [ ]` / `- [x]`)',
        done: false,
      });
      expect(criteria[2]).toEqual({
        text: 'Neu laden bei `TASK_HANDOVER`, `REVIEW_START`, `PR_READY` und `MERGED`, kein Dauer-Polling',
        done: false,
      });
      expect(criteria[3]).toEqual({
        text: 'PR-Badge `Draft` → `Ready` → `Merged` sowie CI-Status (`CI_CHECK_PASS`/`FAIL`)',
        done: false,
      });
      expect(criteria[4]).toEqual({
        text: '`gh` nicht verfügbar oder Issue nicht gefunden: verständlicher Hinweis statt Fehler',
        done: false,
      });
      expect(criteria[5]).toEqual({
        text: 'Unit-Tests für den Checklisten-Parser',
        done: false,
      });
    });
  });

  describe('fetchTicket', () => {
    it('executes gh issue view with correct args and returns parsed ticket', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          number: 15,
          title: 'Ticket Tracker',
          body: '## Akzeptanzkriterien\n- [ ] Done check',
        }),
        stderr: '',
      });

      const ticket = await fetchTicket('15', '/path/to/worktree', mockExec);
      expect(ticket).toEqual({
        number: 15,
        title: 'Ticket Tracker',
        body: '## Akzeptanzkriterien\n- [ ] Done check',
      });

      expect(mockExec).toHaveBeenCalledWith(
        'gh',
        ['issue', 'view', '15', '--json', 'number,title,body'],
        {
          cwd: '/path/to/worktree',
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        },
      );
    });

    it('strips leading # and normalizes ticketId', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          number: 42,
          title: 'Ticket 42',
          body: '',
        }),
        stderr: '',
      });

      const ticket = await fetchTicket(' #42 ', '/path/to/repo', mockExec);
      expect(ticket.number).toBe(42);
      expect(mockExec).toHaveBeenCalledWith(
        'gh',
        ['issue', 'view', '42', '--json', 'number,title,body'],
        expect.any(Object),
      );
    });

    it('caches ticket per (cwd, ticketId) for ~30 seconds', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          number: 15,
          title: 'Cached Ticket',
          body: '',
        }),
        stderr: '',
      });

      const ticket1 = await fetchTicket('15', '/repo/worktree-a', mockExec);
      const ticket2 = await fetchTicket('15', '/repo/worktree-a', mockExec);
      expect(ticket1).toBe(ticket2);
      expect(mockExec).toHaveBeenCalledTimes(1);

      // Different cwd must not hit the cache of worktree-a
      await fetchTicket('15', '/repo/worktree-b', mockExec);
      expect(mockExec).toHaveBeenCalledTimes(2);

      // Different ticketId must not hit the cache
      await fetchTicket('16', '/repo/worktree-a', mockExec);
      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it('throws TicketNotFoundError when ticket is not found', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockRejectedValue({
        code: 1,
        stderr:
          'GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)',
        message: 'Command failed',
      });

      await expect(
        fetchTicket('999999', '/repo', mockExec),
      ).rejects.toThrowError(TicketNotFoundError);
    });

    it('throws GitHubCliError when gh is not installed (ENOENT)', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockRejectedValue({
        code: 'ENOENT',
        message: 'spawn gh ENOENT',
      });

      await expect(fetchTicket('15', '/repo', mockExec)).rejects.toThrowError(
        GitHubCliError,
      );
    });

    it('throws GitHubCliError on timeout', async () => {
      const mockExec: ExecFileFunction = vi.fn().mockRejectedValue({
        killed: true,
        signal: 'SIGTERM',
        message: 'timed out',
      });

      await expect(fetchTicket('15', '/repo', mockExec)).rejects.toThrowError(
        GitHubCliError,
      );
    });

    it('throws TicketNotFoundError for empty ticketId', async () => {
      await expect(fetchTicket('   ', '/repo')).rejects.toThrowError(
        TicketNotFoundError,
      );
    });
  });
});
