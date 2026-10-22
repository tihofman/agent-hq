# delegate.sh installieren

Voraussetzungen: Bash, curl und jq; außerdem `agy` bzw. `codex` im PATH.
Die Bash-Tests benötigen zusätzlich Node.js (bereits im Projekt verwendet).

Vom Repository-Verzeichnis aus das Skript in den Claude-Skill kopieren:

```bash
mkdir -p ~/.claude/skills/subagent-orchestrator
cp scripts/delegate.sh ~/.claude/skills/subagent-orchestrator/delegate.sh
```

Alternativ als Symlink einbinden (vorhandenes Skript vorher sichern/entfernen):

```bash
ln -s "$PWD/scripts/delegate.sh" ~/.claude/skills/subagent-orchestrator/delegate.sh
```

Aufruf: `scripts/delegate.sh agy "Implementiere #7"` (oder `codex`).
`AGENT_HQ_URL` überschreibt `http://127.0.0.1:3333`; `TICKET_ID` überschreibt
die Ticket-Erkennung aus dem Prompt. Logs liegen unter `${TMPDIR:-/tmp}/agent-hq/<runId>.log`.

`AGENT_HQ_LOG_DIR` überschreibt das Log-Verzeichnis (bei Server und Skript gleich setzen).

Der Kill Switch bietet eine optionale „Anweisung für Fortsetzung“ (maximal 4000 Zeichen).
Ohne Anweisung beendet er den Worker wie bisher. Mit Anweisung schreibt der Server
vor dem Signal eine `.msg` neben das registrierte Log, ausschließlich im erwarteten
Log-Verzeichnis. Nach dem Worker-Ende liest und entfernt `delegate.sh` diese Datei.
Die Anweisung erscheint als `>>> User-Anweisung: …` in stdout und im neuen Run-Log.
Jede Fortsetzung bekommt eine neue Run-ID, ein eigenes Log und neue Handover-/Start-Events;
Exit-Code und Bash-Aufruf bleiben für Claude transparent. Mehrfaches Nachsteuern ist möglich.

codex liefert die Session-ID über `session id:` im Log und wird mit `exec resume`
fortgesetzt. Da resume keine `-s`/`--add-dir`-Flags unterstützt, setzt es die Sandbox
über `-c sandbox_mode="workspace-write"`, Netzwerkzugriff und die Schreibverzeichnisse
(Arbeitsverzeichnis und `~/.npm`) explizit wie beim Erstlauf.

agy läuft mit `--output-format stream-json`: Das frühe Init-Event liefert
`conversation_id`, auch wenn der Lauf später abgebrochen wird. Der Ausgabefilter
schreibt diese als `conversation id:` und rendert Text aus Assistant-Events zeilenweise;
unbekannte Events und Diagnosen bleiben unverändert sichtbar. So bleibt das Log für
den Tailer lesbar, ohne zusätzliche Abhängigkeit. Fortsetzung erfolgt gezielt mit
`--conversation <id>` und denselben Berechtigungen wie beim Erstlauf.
Fehlt eine Session-ID, startet der Worker mit Originalprompt und bisherigen Anweisungen neu.

Prüfen mit `bash scripts/test/delegate.test.sh` und
`bash scripts/test/delegate-resume.test.sh` (Fake-CLIs, keine echten Worker).
