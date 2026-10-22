# Claude-Code-Hook (`hq-hook.sh`) für `gh pr`-Events

Der Hook `scripts/hq-hook.sh` überwacht die von Claude Code im Terminal ausgeführten GitHub-CLI-Befehle (`gh pr`) und meldet Lifecycle-Events automatisch an Agent-HQ. Dadurch erscheinen PR-, Review-, CI- und Merge-Status im Dashboard, ohne dass Claude diese Schritte manuell übermitteln muss.

---

## 1. Registrierung in `~/.claude/settings.json`

Der Hook muss für **beide** Hook-Events `PostToolUse` und `PostToolUseFailure` mit dem Matcher `"Bash"` registriert werden:

- `PostToolUse` feuert nach erfolgreichen Tool-Aufrufen (Exit-Code 0).
- `PostToolUseFailure` feuert bei fehlgeschlagenen Tool-Aufrufen (Exit-Code ≠ 0).

In `~/.claude/settings.json` (oder projektbezogen in `.claude/settings.json`):

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
    ],
    "PostToolUseFailure": [
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

| Kommando-Muster             | Hook-Event           | Bedingung                        | Event              | Beschreibung                                         |
| :-------------------------- | :------------------- | :------------------------------- | :----------------- | :--------------------------------------------------- |
| `gh pr create --draft`      | `PostToolUse`        | Erstellung erfolgreich           | `DRAFT_PR_CREATED` | Draft-Pull-Request wurde erstellt                    |
| `gh pr diff` / `gh pr view` | `PostToolUse`        | Befehl erfolgreich               | `REVIEW_START`     | Review des PRs wurde gestartet                       |
| `gh pr ready`               | `PostToolUse`        | Befehl erfolgreich               | `PR_READY`         | PR wurde von Draft auf „Ready for Review“ geschaltet |
| `gh pr checks`              | `PostToolUse`        | Exit-Code 0                      | `CI_CHECK_PASS`    | Alle CI-Checks erfolgreich durchgelaufen             |
| `gh pr checks`              | `PostToolUseFailure` | Exit-Code 1                      | `CI_CHECK_FAIL`    | Mindestens ein CI-Check fehlgeschlagen               |
| `gh pr checks`              | `PostToolUseFailure` | Exit-Code 8 (pending) / sonstige | _(kein Event)_     | Checks laufen noch oder temporärer Fehler            |
| `gh pr merge`               | `PostToolUse`        | Merge erfolgreich                | `MERGED`           | PR wurde erfolgreich gemerged                        |

Befehle, die keinem dieser Muster entsprechen (z.B. `git status`, `npm test`), oder fehlschlagende Operationen abseits von `gh pr checks` (z.B. ein abgelehnter `gh pr merge`), senden keine Events.

---

## 3. Hook-Eingabeformat & Exit-Code-Verarbeitung

Gemäß der offiziellen Claude-Code-Dokumentation ([Hooks Reference](https://code.claude.com/docs/en/hooks)) liefert `PostToolUse` bei erfolgreicher Ausführung von `Bash` das Objekt `tool_response` mit `stdout`, `stderr`, `interrupted` und `isImage`, jedoch **keinen numerischen Exit-Code**. Schlägt ein Befehl fehl (Exit-Code ≠ 0), feuert stattdessen `PostToolUseFailure` mit dem Textfeld `error`.

### Erfolgreicher Aufruf (`PostToolUse`)

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
    "stdout": "✓ build (push) pass 1m32s\n✓ test (push) pass 45s\n",
    "stderr": "",
    "interrupted": false,
    "isImage": false
  }
}
```

Bei `hook_event_name == "PostToolUse"` und `gh pr checks` steht fest, dass der Befehl mit Exit-Code 0 beendet wurde. Der Hook meldet daher direkt `CI_CHECK_PASS`.

### Fehlgeschlagener Aufruf (`PostToolUseFailure`)

```json
{
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "tool_input": {
    "command": "gh pr checks 42"
  },
  "error": "Exit code 1\n✕ build (push) fail 1m32s\n"
}
```

Bei `hook_event_name == "PostToolUseFailure"` liest `hq-hook.sh` den Exit-Code `N` aus dem Feld `.error` (`Exit code N`):

- `N = 1` bei `gh pr checks` ➔ `CI_CHECK_FAIL`.
- `N = 8` (GitHub CLI Status für _pending checks_) oder sonstige Exit-Codes ➔ kein Event.
- Alle anderen `gh pr`-Kommandos unter `PostToolUseFailure` ➔ kein Event (ein fehlschlagender Merge darf kein `MERGED`-Event auslösen).

---

## 4. Bekannte Heuristiken & PR-Nummern-Extraktion

### Heuristik für Draft-PR-Erkennung (`-d`)

Das Erkennen von Draft-PRs bei `gh pr create` prüft per Regex auf die Flags `--draft` oder `-d` (`(^|[[:space:]])(--draft|-d)([[:space:]]|$)`). Dies ist eine bewusste Heuristik:

- Falls Parameter Werte enthalten, die isoliert `-d` gleichen, könnte dies als Draft interpretiert werden.
- In normalen GitHub-CLI-Aufrufen ist `-d` jedoch das Standard-Kurzflag für `--draft`.

### CI-Ergebnis nur bei alleinstehendem `gh pr checks`

Der Hook sieht nur den Exit-Code des **gesamten** Bash-Aufrufs. Steht `gh pr checks` in einer Kette (`gh pr checks 42; echo done`, `gh pr checks 42 | tail -5`), bestimmt das letzte Kommando den Exit-Code – ein fehlgeschlagener Check wird dann als `CI_CHECK_PASS` gemeldet. Für korrekte CI-Events `gh pr checks` als letztes Kommando bzw. ohne Pipe aufrufen.

### Reihenfolge der PR-Nummern-Extraktion

Die PR-Nummer wird nach folgender Priorität ermittelt und als numerischer Wert in `data.prNumber` übermittelt:

1. **Vorrangig aus dem CLI-Befehl (`COMMAND`)**:
   - URL im Befehl (z.B. `gh pr diff https://github.com/.../pull/15`).
   - Explizites Argument im Befehl (z.B. `gh pr view 28 --json body`, `gh pr checks 42`, `gh pr merge 42 --squash`).
   - Dadurch wird verhindert, dass in der Befehlsausgabe zitierte fremde PR-Nummern (wie Links in Ticket-Beschreibungen) die eigentliche Ziel-PR-Nummer überschreiben.
2. **Aus URLs in der Befehlsausgabe (`tool_response`)**:
   - Wenn der Befehl selbst keine PR-Nummer enthielt (z.B. bei `gh pr create --draft`), wird nach `/pull/<nummer>` in `tool_response.stdout` gesucht.
3. **Fallback auf Merge-Ausgabeformat**:
   - Beim Mergen ohne explizite PR-Nummer (`gh pr merge --squash`) gibt die GitHub-CLI Meldungen wie `Merged pull request #42` aus. Der Fallback sucht gezielt nach `pull request .*#<nummer>`, um falsch-positive Treffer aus allgemeinen Issue-Referenzen (`#<nummer>`) auszuschließen.

Kann keine PR-Nummer ermittelt werden (z.B. bei `gh pr view` ohne Argumente auf einem Branch ohne gemeldeten Link), bleibt `data.prNumber` leer (`data: {}`).

---

## 5. Offline-Resilienz & Timeouts

Um Claudes Workflow niemals zu blockieren:

- Der Exit-Code von `scripts/hq-hook.sh` ist **immer `0`**, auch bei ungültigem JSON, unbekannten Kommandos oder Systemfehlern.
- Alle HTTP-POST-Requests an `${AGENT_HQ_URL:-http://127.0.0.1:3333}/api/events` nutzen dieselben Timeouts wie `delegate.sh`:
  `--connect-timeout 0.1 --max-time 0.5`
- Ist der Agent-HQ-Server offline, bricht `curl` nach maximal 0.1s ab und das Skript beendet sich ohne Verzögerung.
