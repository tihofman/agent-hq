# ADR 0008: Terminal-UI als zweiter Client und Start per tmux

## Status

Accepted (2026-10-25)

## Kontext

Bisher wird Agent-HQ nur über die Web-UI (SvelteKit) bedient. Der User will beim Start entscheiden, ob er im Terminal arbeitet. Dort soll ein Dashboard laufen, und der Orchestrator (eine interaktive Claude-Code-Sitzung mit dem Skill `agent-hq`, siehe #145) soll automatisch mitstarten. Das Ganze soll ein eigenständiges Terminal sein.

Randbedingungen:

- Queue, Worker-Pool, Rückfragen und Historie leben im Server ([ADR 0006](0006-queue-architektur-v2.md), [ADR 0007](0007-mehrere-repos.md)). Live-Daten liefert `GET /api/stream` (SSE, [ADR 0002](0002-sse-und-http-post.md)). Aktionen laufen über die REST-Endpunkte.
- [ADR 0005](0005-kein-pty-chat-korrektur-per-resume.md) verwirft es, interaktive CLI-Sitzungen per PTY in eine eigene Oberfläche einzubetten.
- Der Stack ist TypeScript im Nx-Workspace. Typen liegen in `@agent-hq/queue/types`.

## Entscheidung

### 1. Die TUI ist ein Client, kein Server

- Die neue App `apps/agent-hq-tui` ist eine Node-CLI mit [Ink](https://github.com/vadimdemedes/ink). Sie verbindet sich mit `AGENT_HQ_URL` (Default `http://127.0.0.1:3333`), liest `/api/stream` und nutzt für Aktionen dieselben Endpunkte wie die Web-UI.
- Die TUI hat keine eigene Queue-, Worker- oder Redis-Logik und importiert nur Typen (`@agent-hq/queue/types`), keine Server-Module. Web-UI und TUI können gleichzeitig laufen.
- Funktionsumfang:
  - Projekte (ADR 0007), Teams und Slots
  - Queue und laufende Jobs
  - Log des ausgewählten Laufs
  - offene Rückfragen beantworten
  - Draft-PRs anzeigen
  - Kill Switch

  Bedienung per Tastatur. Die Tastenbelegung zeigt die TUI selbst an.

- Ist der Server nicht erreichbar, zeigt die TUI das deutlich an und verbindet sich automatisch neu.

### 2. Start per tmux, Orchestrator in eigenem Pane

- Ein Startbefehl `scripts/agent-hq` bzw. `run.sh --tui|--web` entscheidet über den Modus. Ohne Flag wird interaktiv gefragt, bei nicht-interaktivem Terminal gilt `--web` (das heutige Verhalten).
- `--tui` baut eine tmux-Sitzung `agent-hq` auf oder hängt sich an eine bestehende an:
  - **Pane links:** TUI-Dashboard.
  - **Pane rechts:** `claude`, der Orchestrator. Er startet automatisch im Verzeichnis, aus dem der Befehl aufgerufen wurde, und läuft im normalen Berechtigungsmodus, ohne `--dangerously-skip-permissions`, weil der User davor sitzt.
  - **Pane unten:** Server-Log.
  - Läuft der Server noch nicht, startet der Befehl ihn in einem eigenen tmux-Fenster. Läuft er schon, wird er nur genutzt.
- Fehlt der Skill `agent-hq` in Claude Code, weist der Startbefehl darauf hin und zeigt den Installationsbefehl. Selbst installiert er nichts, weil das die Konfiguration des Users ändern würde.
- tmux ist Voraussetzung für `--tui`. Fehlt es, bricht der Befehl mit einem Installationshinweis ab.
- Die Sitzung lässt sich lösen (`tmux detach`) und wieder anhängen. Server und Orchestrator laufen dabei weiter.

## Konsequenzen

- Der Orchestrator ist ein echtes `claude`, kein Nachbau. ADR 0005 bleibt gewahrt, weil tmux die Terminal-Verwaltung übernimmt.
- Neue Laufzeitabhängigkeiten: tmux (nur für `--tui`) und Ink (nur in `apps/agent-hq-tui`).
- Die API ist jetzt Vertrag für zwei Clients. Änderungen an `/api/stream` oder den Endpunkten müssen beide berücksichtigen.
