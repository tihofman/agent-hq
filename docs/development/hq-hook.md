# Claude-Code-Hook (`hq-hook.sh`) für `gh pr`-Events

Der Hook `scripts/hq-hook.sh` überwacht die von Claude Code im Terminal ausgeführten GitHub-CLI-Befehle (`gh pr`) und meldet Lifecycle-Events automatisch an Agent-HQ. Dadurch erscheinen PR-, Review-, CI- und Merge-Status im Dashboard, ohne dass Claude diese Schritte manuell übermitteln muss.

---

## 1. Registrierung in `~/.claude/settings.json`

Der Hook wird als `PostToolUse`-Hook mit dem Matcher `"Bash"` in `~/.claude/settings.json` (oder projektbezogen in `.claude/settings.json`) hinterlegt:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/ABSOLUTER/PFAD/ZU/agent-hq/scripts/hq-hook.sh"
          }
        ]
      }
    ]
  }
}
```

> **Hinweis**: Ersetze `/ABSOLUTER/PFAD/ZU/agent-hq` durch den absoluten Pfad zu deinem lokalen Repository-Klon. Stelle sicher, dass das Skript ausführbar ist (`chmod +x scripts/hq-hook.sh`).

---

## 2. Kommando- und Event-Zuordnung

| Kommando-Muster              | Event                             | Beschreibung                                         |
| :--------------------------- | :-------------------------------- | :--------------------------------------------------- |
| `gh pr create --draft`       | `DRAFT_PR_CREATED`                | Draft-Pull-Request wurde erstellt                    |
| `gh pr diff` / `gh pr view`  | `REVIEW_START`                    | Review des PRs wurde gestartet                       |
| `gh pr ready`                | `PR_READY`                        | PR wurde von Draft auf „Ready for Review“ geschaltet |
| `gh pr checks` (Pass / Fail) | `CI_CHECK_PASS` / `CI_CHECK_FAIL` | CI-Pipeline-Status der Checks                        |
| `gh pr merge`                | `MERGED`                          | PR wurde erfolgreich gemerged                        |

Befehle, die keinem dieser Muster entsprechen (z.B. `git status`, `npm test`), werden ignoriert und senden keine Events.

---

## 3. PostToolUse-Eingabeformat & Exit-Code-Annahme

Claude Code übergibt dem Hook auf `stdin` ein JSON-Objekt mit folgendem Aufbau:

```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "gh pr checks 42"
  },
  "tool_response": {
    "stdout": "✓ build (push) pass 1m32s\n✕ test (push) fail 45s\n",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

### Analyse & Annahme zu `tool_response`

Gemäß der offiziellen Claude-Code-Dokumentation ([Hooks Reference](https://code.claude.com/docs/en/hooks)) enthält das `tool_response`-Objekt des `Bash`-Tools die Felder `stdout`, `stderr`, `interrupted` und `isImage`, jedoch **keinen numerischen Exit-Code**.

**Ermittlung von `CI_CHECK_PASS` vs. `CI_CHECK_FAIL`:**

1. Enthält `tool_response` ein explizites Feld `exitCode` bzw. `exit_code` (z.B. in Test-Mock-Umgebungen oder künftigen CLI-Versionen), wird dieses vorrangig ausgewertet (`exitCode ≠ 0` ➔ `CI_CHECK_FAIL`).
2. Fehlt der Exit-Code, analysiert `hq-hook.sh` die Textausgabe (`stdout` und `stderr`):
   - Finden sich darin Fehlerindikatoren (`fail`, `failure`, `error`, `✕` etc.), wird `CI_CHECK_FAIL` gemeldet (Fehler haben Vorrang bei gemischten Zeilen).
   - Finden sich Erfolgsindikatoren (`pass`, `passed`, `success`, `✓` etc.) und keine Fehler, wird `CI_CHECK_PASS` gemeldet.
   - Wurden keine Fehler festgestellt, fällt die Bestimmung auf `CI_CHECK_PASS` zurück.

---

## 4. PR-Nummern-Extraktion

Die PR-Nummer wird automatisch ermittelt und als numerischer Wert in `data.prNumber` übermittelt:

1. **Aus URLs**: Findet sich ein Muster `/pull/<nummer>` in `tool_response` (z.B. die von `gh pr create` zurückgegebene PR-URL) oder im Befehl selbst, wird diese Nummer extrahiert.
2. **Aus Befehlsargumenten**: Bei Befehlen wie `gh pr view 8`, `gh pr ready #42` oder `gh pr merge 42 --squash` wird das Zahlenargument ausgewertet.

Kann keine PR-Nummer ermittelt werden (z.B. bei `gh pr view` ohne Argumente auf einem Branch ohne gemeldeten Link), bleibt `data.prNumber` leer (`data: {}`).

---

## 5. Offline-Resilienz & Timeouts

Um Claudes Workflow niemals zu blockieren:

- Der Exit-Code von `scripts/hq-hook.sh` ist **immer `0`**, auch bei ungültigem JSON, unbekannten Kommandos oder Systemfehlern.
- Alle HTTP-POST-Requests an `${AGENT_HQ_URL:-http://127.0.0.1:3333}/api/events` nutzen dieselben Timeouts wie `delegate.sh`:
  `--connect-timeout 0.1 --max-time 0.5`
- Ist der Agent-HQ-Server offline, bricht `curl` nach maximal 0.1s ab und das Skript beendet sich ohne Verzögerung.
