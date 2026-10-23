# ADR 0006: Redis/BullMQ-Queues, TeamLeads und Rückfragen als pausierte Jobs (V2)

## Status

Accepted (2026-10-23)

## Kontext

V2 macht Agent-HQ vom reinen Beobachter zum Orchestrator ([Konzept](../concepts/multi-team-queue-architecture.md)): GitHub Issues mit Label `team:*` landen in Team-Queues, autonome TeamLeads (Frontend, Backend, QA) arbeiten sie über `delegate.sh` ab, wechseln bei Rate-Limits die Subscription und stellen dem User Rückfragen über die UI.

Das kollidiert mit bisherigen Festlegungen:

- arc42 1.2 nennt „keine Datenbank“ als Qualitätsziel; [ADR 0003](0003-jsonl-historie.md) hält den Zustand im Speicher.
- [ADR 0002](0002-sse-und-http-post.md) akzeptiert Event-Verlust bei Server-Ausfall. Tasks dürfen aber nicht verloren gehen.
- [ADR 0005](0005-kein-pty-chat-korrektur-per-resume.md) schließt einen Dialog mit einem laufenden Worker aus. Korrekturen laufen über Abbruch und Session-Fortsetzung.
- BullMQ kennt kein Pausieren eines einzelnen laufenden Jobs.
- Das Konzept nutzt für dieselben Events unterschiedliche Namen (`subscription:failover` / `subscription:switched`, `team:waiting_input` / `question:pending` / `question:new`).

## Entscheidung

### 1. Redis + BullMQ als Task-Backbone

- Redis 7 läuft in Docker (`docker-compose.yml`, nur `127.0.0.1:6379`, AOF, Volume `redis_data`). `run.sh` startet den Container vor dem Server.
- BullMQ hält je Team eine Queue (`tasks:frontend`, `tasks:backend`, `tasks:qa`). Job-ID ist die Issue-Nummer.
- Events (`POST /api/events`, SSE `/api/stream`, JSONL-Historie) bleiben wie in ADR 0002 und 0003. Redis speichert nur Tasks, Rückfragen und den Subscription-Status.

### 2. TeamLeads laufen im Server-Prozess

- Die BullMQ-Worker der TeamLeads starten im SvelteKit-Prozess (`adapter-node`), Concurrency 1 pro Team.
- Ein TeamLead startet `delegate.sh` als Kindprozess. Damit bleiben PID, Run-Log, Events und Kill Switch unverändert (ADR 0004).
- Beim Herunterfahren schließt der Server die Worker sauber. Ein durch Absturz verwaister Job wird von BullMQ als `stalled` erkannt und erneut gestartet.

### 3. Rückfragen sind pausierte Jobs auf der Team-Queue

1. Braucht der Worker eine Entscheidung, schreibt er die Frage nach Vorgabe im Prompt nach `.agent-hq/question.json` im Worktree (`question`, optional `options`) und beendet sich.
2. Der TeamLead findet die Datei nach Prozessende und legt den Job **pausiert auf seine Team-Queue** zurück: Die Frage kommt in die Job-Daten (`question.status = 'PENDING'`), der Job wechselt in den Zustand `delayed` (`job.moveToDelayed` + `DelayedError`). Die Session-ID des Laufs wird mitgespeichert.
3. Der TeamLead ist sofort frei für den nächsten Job seines Teams. Das Issue bekommt `status:blocked`, die UI erhält `QUESTION_PENDING`.
4. Antwortet der User (`POST /api/questions/:id/answer`), schreibt der Server die Entscheidung in die Job-Daten (`question.status = 'ANSWERED'`, `answer`) und stellt den Job **wieder als umsetzbar** in die Queue (`job.promote()`). Die UI erhält `QUESTION_RESOLVED`.
5. Der TeamLead nimmt den Job erneut auf und setzt die Session mit der Entscheidung des Users fort (`resume` / `--conversation`, wie in ADR 0005). Gibt es keine Session-ID, startet er einen neuen Lauf mit Frage und Antwort im Prompt.

Der Pausen-Delay ist lang (z. B. 7 Tage). Wird ein Job ohne Antwort wieder aktiv, stellt der TeamLead ihn erneut zurück. Eine eigene `questions`-Queue gibt es nicht: Offene Rückfragen sind die `delayed`-Jobs aller Team-Queues mit `question.status = 'PENDING'`.

### 4. Event-Namen

Neue Events folgen dem bestehenden UPPER_SNAKE-Schema:

| Event                   | `data`                                              |
| :---------------------- | :-------------------------------------------------- |
| `SUBSCRIPTION_FAILOVER` | `{ team, from, to, cooldownUntil }`                 |
| `QUESTION_PENDING`      | `{ questionId, issueId, team, question, options? }` |
| `QUESTION_RESOLVED`     | `{ questionId, issueId, team, answer }`             |

`questionId` ist `<issueId>-<n>`; `n` zählt die Rückfragen eines Issues hoch.

### 5. Ohne Docker oder Redis

Agent-HQ startet trotzdem. Das V1-Monitoring (Events, Büro, Feed, Kill Switch) läuft unverändert, die V2-Funktionen (Ingest, TeamLeads, Rückfragen) sind deaktiviert. `run.sh` und der Server geben dazu eine Warnung aus.

## Konsequenzen

### Positiv

- Tasks und offene Rückfragen überleben Server- und Container-Neustarts.
- Eine Rückfrage blockiert weder Terminal noch TeamLead; andere Issues des Teams laufen weiter.
- Kein zusätzlicher Zustandsspeicher für Rückfragen: Job-Daten und Job-Zustand reichen.
- Fortsetzung per Session-Resume nutzt den vorhandenen Mechanismus aus ADR 0005, ohne PTY.
- V1 bleibt ohne Docker voll nutzbar.

### Negativ / Trade-offs

- Docker und Redis werden für V2 Pflicht; das Qualitätsziel „keine Datenbank“ entfällt.
- Ob ein Worker die Rückfrage-Datei schreibt, hängt vom Modell ab. Fehlt sie, endet der Lauf normal oder als Fehlschlag.
- Ein Server-Absturz während eines Laufs kann den Worker verwaisen lassen, während BullMQ den Job neu startet. Der zweite Lauf arbeitet im selben Worktree weiter.
- `job.moveToDelayed`/`promote` binden die Lösung an BullMQ-Interna.
