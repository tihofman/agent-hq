# ADR 0006: Redis/BullMQ-Team-Queues, Worker-Pool und Rückfragen als pausierte Jobs (V2)

## Status

Accepted (2026-10-23)

## Kontext

V2 macht Agent-HQ vom reinen Beobachter zum Orchestrator ([Konzept](../concepts/multi-team-queue-architecture.md)): GitHub Issues mit Label `team:*` landen in Team-Queues, Teams (Frontend, Backend, QA) arbeiten sie über `delegate.sh` ab, wechseln bei Rate-Limits die Subscription und stellen dem User Rückfragen über die UI.

Das kollidiert mit bisherigen Festlegungen:

- arc42 1.2 nennt „keine Datenbank“ als Qualitätsziel; [ADR 0003](0003-jsonl-historie.md) hält den Zustand im Speicher.
- [ADR 0002](0002-sse-und-http-post.md) akzeptiert Event-Verlust bei Server-Ausfall. Tasks dürfen aber nicht verloren gehen.
- [ADR 0005](0005-kein-pty-chat-korrektur-per-resume.md) schließt einen Dialog mit einem laufenden Worker aus. Korrekturen laufen über Abbruch und Session-Fortsetzung.
- BullMQ kennt kein Pausieren eines einzelnen laufenden Jobs. Einen aktiven Job darf nur der Worker verschieben, der seine Sperre hält.
- Die Worker-CLIs (`agy`, `codex`, `claude`) sind Einmal-Aufrufe, keine Daemons. Verlässliches Abschlusssignal ist nur das Prozessende mit Exit-Code.
- Das Konzept nutzt für dieselben Events unterschiedliche Namen (`subscription:failover` / `subscription:switched`, `team:waiting_input` / `question:pending` / `question:new`).

## Entscheidung

### 1. Redis + BullMQ als Task-Backbone

- Redis 7 läuft in Docker (`docker-compose.yml`, nur `127.0.0.1:6379`, AOF, Volume `redis_data`). `run.sh` startet den Container vor dem Server.
- BullMQ hält je Team eine Queue (`tasks-frontend`, `tasks-backend`, `tasks-qa`). Job-ID ist `issue-<Nummer>` (BullMQ verbietet rein numerische IDs). BullMQ erlaubt keinen Doppelpunkt in Queue-Namen.
- Events (`POST /api/events`, SSE `/api/stream`, JSONL-Historie) bleiben wie in ADR 0002 und 0003. Redis speichert nur Tasks, Rückfragen und den Subscription-Status.

### 2. Fester Worker-Pool, TeamLead ist Logik statt Prozess

- Ein Pool aus **4 Worker-Slots** läuft im SvelteKit-Prozess (`adapter-node`), verteilt über die BullMQ-Concurrency der Team-Queues. Default: Frontend 2, Backend 1, QA 1 (konfigurierbar).
- Ein Slot nimmt einen Job, startet `delegate.sh` als Kindprozess und hält den Job bis zum Prozessende. Das ist nötig, weil BullMQ die Job-Sperre nur für einen lebenden Worker verlängert und nur der Exit-Code den Abschluss sicher anzeigt. PID, Run-Log, Events und Kill Switch bleiben unverändert (ADR 0004).
- Der **TeamLead** ist kein eigener Prozess, sondern die Team-Logik, die ein Slot pro Job ausführt: Provider wählen, Prompt bauen, Ergebnis auswerten. Den Zustand eines Teams (`idle`, `working`, `waiting_input`) leiten UI und Server aus den Job-Zuständen der Team-Queue ab.
- **Reparaturen laufen über die Queue:** Ein fehlgeschlagener Lauf endet als BullMQ-Fehlschlag mit Retry (`attempts: 4`, also bis zu 3 Reparaturen). Die Fehlerausgabe steht in den Job-Daten und geht in den Prompt des nächsten Versuchs. Zwischen den Versuchen ist der Slot frei.
- **Rate-Limits** zählen nicht als Reparaturversuch: Der Slot setzt den Provider auf `COOLDOWN` und startet den Lauf sofort mit dem Fallback-Provider neu.
- Beim Herunterfahren schließt der Server die Worker sauber. Ein durch Absturz verwaister Job wird von BullMQ als `stalled` erkannt und erneut gestartet.

### 3. Rückfragen sind pausierte Jobs auf der Team-Queue

1. Braucht der Worker eine Entscheidung, ruft er `scripts/hq-ask.sh "<Frage>" [--option "<A>" …]` auf. Der Helfer sendet die Frage an `POST /api/questions`. Issue und Lauf kennt er aus Umgebungsvariablen, die `delegate.sh` setzt.
2. Der Server schreibt die Frage in die Daten des laufenden Jobs (`job.updateData`, `question.status = 'PENDING'`). Das braucht die Job-Sperre nicht. Er sendet sofort `QUESTION_PENDING`; das `?` erscheint, während der Worker sich noch beendet.
3. Der Worker beendet sich danach. Der Prompt schreibt das vor, und `hq-ask.sh` gibt es als letzte Anweisung aus. Läuft der Worker nach einer Karenzzeit noch, beendet ihn der Slot über den Kill-Mechanismus.
4. Beim Prozessende sieht der Slot die offene Frage und legt den Job **pausiert auf die Team-Queue** zurück (`job.moveToDelayed` + `DelayedError`, langer Delay, z. B. 7 Tage). Die Session-ID des Laufs wird mitgespeichert, das Issue bekommt `status:blocked`. Der Slot ist sofort frei für den nächsten Job.
5. Antwortet der User (`POST /api/questions/:id/answer`), schreibt der Server die Entscheidung in die Job-Daten (`question.status = 'ANSWERED'`, `answer`) und stellt den Job **wieder als umsetzbar** in die Queue (`job.promote()`). Die UI erhält `QUESTION_RESOLVED`.
6. Ein Slot nimmt den Job erneut auf und setzt die Session mit der Entscheidung des Users fort (`resume` / `--conversation`, wie in ADR 0005). Ohne Session-ID startet er einen neuen Lauf mit Frage und Antwort im Prompt.

Wird ein Job ohne Antwort wieder aktiv, stellt der Slot ihn erneut zurück. Eine eigene `questions`-Queue gibt es nicht: Offene Rückfragen sind die Jobs aller Team-Queues mit `question.status = 'PENDING'`.

### 4. Event-Namen

Neue Events folgen dem bestehenden UPPER_SNAKE-Schema:

| Event                   | `data`                                              |
| :---------------------- | :-------------------------------------------------- |
| `SUBSCRIPTION_FAILOVER` | `{ team, from, to, cooldownUntil }`                 |
| `QUESTION_PENDING`      | `{ questionId, issueId, team, question, options? }` |
| `QUESTION_RESOLVED`     | `{ questionId, issueId, team, answer }`             |

`questionId` ist `<issueId>-<n>`; `n` zählt die Rückfragen eines Issues hoch.

### 5. Ohne Docker oder Redis

Agent-HQ startet trotzdem. Das V1-Monitoring (Events, Büro, Feed, Kill Switch) läuft unverändert, die V2-Funktionen (Ingest, Worker-Pool, Rückfragen) sind deaktiviert. `run.sh` und der Server geben dazu eine Warnung aus.

## Konsequenzen

### Positiv

- Tasks und offene Rückfragen überleben Server- und Container-Neustarts.
- Ein Slot ist nur belegt, solange ein Worker-Prozess läuft. Retries und offene Rückfragen liegen nur in der Queue und blockieren keinen Slot.
- Der Zustand jedes Teams ist allein aus der Queue ablesbar; kein TeamLead-Daemon muss überwacht werden.
- Die Rückfrage ist strukturiert und erscheint sofort in der UI, nicht erst nach Prozessende.
- Reparaturen nutzen die BullMQ-Retries statt einer eigenen Schleife.
- Fortsetzung per Session-Resume nutzt den vorhandenen Mechanismus aus ADR 0005, ohne PTY.
- V1 bleibt ohne Docker voll nutzbar.

### Negativ / Trade-offs

- Docker und Redis werden für V2 Pflicht; das Qualitätsziel „keine Datenbank“ entfällt.
- Ob ein Worker `hq-ask.sh` nutzt und sich danach beendet, hängt vom Modell ab. Die Karenzzeit mit Kill fängt nur den zweiten Fall ab.
- Bei fester Slot-Verteilung kann ein Team warten, während Slots eines anderen Teams frei sind.
- Ein Server-Absturz während eines Laufs kann den Worker verwaisen lassen, während BullMQ den Job neu startet. Der zweite Lauf arbeitet im selben Worktree weiter.
- `job.moveToDelayed`/`promote` binden die Lösung an BullMQ-Interna.
