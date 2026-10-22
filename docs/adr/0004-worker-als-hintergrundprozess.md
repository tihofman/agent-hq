# ADR 0004: Worker als Hintergrundprozess in delegate.sh statt `exec … | tee`

## Status

Accepted (2026-10-22)

## Kontext

`delegate.sh` startet den Worker (`agy` / `codex`) und soll

1. die **echte Worker-PID** an Agent-HQ melden, damit der Kill Switch den richtigen Prozess beenden kann,
2. nach Prozessende `TASK_COMPLETE` / `TASK_FAILED` **mit Exit-Code** senden,
3. die Ausgabe gleichzeitig im Terminal zeigen und in ein Run-Log schreiben.

Der naheliegende Ansatz `exec agy … | tee "$LOG"` erfüllt das nicht: In einer Pipeline läuft jeder Teil in einer eigenen Subshell. `exec` ersetzt dann nur diese Subshell, nicht den Skriptprozess. `$$` zeigt weiterhin auf die Skript-Shell, nicht auf `agy`. Ein Kill auf diese PID ließe `agy` verwaist weiterlaufen. Zudem kehrt nach `exec` kein Code mehr ins Skript zurück, sodass kein Abschluss-Event mit Exit-Code gesendet werden kann.

## Entscheidung

- Der Worker läuft als **Hintergrundprozess**, die Ausgabe wird per **Process Substitution** nach `tee` umgeleitet; die PID kommt aus `$!`:
  ```bash
  "${CMD[@]}" > >(tee "$LOG") 2>&1 &
  PID=$!
  hq_event TASK_START "$PID"
  wait "$PID"; CODE=$?
  ```
- Nach `wait` sendet `delegate.sh` `TASK_COMPLETE` (Exit 0) bzw. `TASK_FAILED` mit Exit-Code und beendet sich mit demselben Code.
- `SIGTERM`/`SIGINT` an `delegate.sh` werden per `trap` an den Worker weitergereicht.
- Jeder Lauf schreibt in ein eigenes Log `$TMPDIR/agent-hq/<runId>.log`.
- Referenzimplementierung: [orchestrator-skill.md, Abschnitt 4B](../concepts/orchestrator-skill.md).

## Konsequenzen

### Positiv

- Der Server kennt die echte Worker-PID; der Kill Switch beendet Kindprozesse und Worker gezielt.
- Exit-Codes werden zuverlässig als Event gemeldet; Claude sieht Abbruch und Fehler über den Exit-Code von `delegate.sh`.
- Parallele Läufe überschreiben ihre Logs nicht.

### Negativ / Trade-offs

- Mehr Shell-Logik: `trap`, Warten auf echtes Prozessende nach Signal-Unterbrechung von `wait`.
- Process Substitution ist Bash-spezifisch (kein POSIX `sh`).
- `tee` läuft in einem eigenen Prozess; die letzte Ausgabe kann minimal nach Prozessende im Log landen.
