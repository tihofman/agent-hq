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

Prüfen mit `bash scripts/test/delegate.test.sh`.
