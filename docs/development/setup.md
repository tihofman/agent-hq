# Entwicklungs-Setup & Grundlagen

Dieses Dokument beschreibt die Einrichtung der lokalen Umgebung, den Start von Agent-HQ, Konfigurationsoptionen und die Anbindung von Worker-Agenten.

---

## 1. Voraussetzungen

Folgende Werkzeuge müssen auf dem System installiert und im `PATH` verfügbar sein:

- **Node.js** (v24 oder neuer) inkl. **npm**
- **jq** (Kommandozeilen-JSON-Prozessor für Bash-Hooks und Skripte)
- **GitHub CLI (`gh`)** (für PR-, Check- und Workflow-Interaktionen)
- **git** (für Versionsverwaltung und Git Worktrees)

Optional (für Worker-Subagenten):

- **agy** (Antigravity CLI / Gemini Subagent)
- **codex** (Codex Subagent)

---

## 2. Server starten

### One-Click-Start (Produktions-Build & Server)

Mit `./run.sh` im Repository-Root wird Agent-HQ mit einem einzigen Befehl gestartet:

```bash
./run.sh
```

Das Skript:

1. Prüft alle erforderlichen Werkzeuge (`node`, `npm`, `jq`, `gh`).
2. Verifiziert, dass der konfigurierte Port frei ist. Ist der Port belegt, wird der belegende Prozess ausgegeben und das Skript bricht mit Exit-Code 1 ab.
3. Installiert Abhängigkeiten (`npm ci`), falls das Verzeichnis `node_modules` noch nicht existiert.
4. Baut die SvelteKit-Anwendung und startet den Server über `npx nx start agent-hq` auf `http://127.0.0.1:3333`.

### Entwicklungsserver (HMR / Hot Reload)

Für die aktive Frontend- und UI-Entwicklung wird der Vite-Entwicklungsserver verwendet:

```bash
npx nx serve agent-hq
```

Der Entwicklungsserver unterstützt schnelles Hot Module Replacement (HMR).

### Tests & Qualitätssicherung

```bash
# Vitest Unit- und Integrationstests
npx nx test agent-hq

# Shell-Skript-Tests (inkl. run.sh, delegate.sh, hq-hook.sh)
bash scripts/test/run.test.sh
for f in scripts/test/*.test.sh; do bash "$f" || exit 1; done

# Gesamte Validierungs-Pipeline (Lint, Test, Build, Typecheck)
npx nx run-many -t lint test build typecheck

# Code-Formatierung prüfen
npx nx format:check --all
```

---

## 3. Konfiguration & Umgebungsvariablen

Agent-HQ und seine Hilfsskripte können über Umgebungsvariablen gesteuert werden:

| Variable           | Standardwert               | Beschreibung                                                                                                           |
| :----------------- | :------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `PORT`             | `3333`                     | Port, auf dem der Agent-HQ-Server lauscht (z.B. `PORT=3482 ./run.sh`).                                                 |
| `HOST`             | `127.0.0.1`                | Bind-Adresse des Servers (standardmäßig nur localhost).                                                                |
| `AGENT_HQ_URL`     | `http://127.0.0.1:3333`    | Basis-URL, die von Client-Skripten (`delegate.sh`, `hq-hook.sh`) zur Ingest-API aufgerufen wird.                       |
| `AGENT_HQ_HOME`    | `~/.agent-hq`              | Verzeichnis zur Speicherung der persistenten Event-Historie (`history.jsonl`).                                         |
| `AGENT_HQ_LOG_DIR` | `${TMPDIR:-/tmp}/agent-hq` | Verzeichnis für Ausführungs-Logs delegierter Worker-Runs (`<runId>.log`).                                              |
| `RUN_SH_DRY_RUN`   | `0`                        | Wenn auf `1` gesetzt, führt `./run.sh` nur Pre-Flight-Prüfungen durch und beendet ohne Serverstart (genutzt in Tests). |

---

## 4. Integration von `delegate.sh` und `hq-hook.sh`

Um Claude Code und Worker-Agenten an Agent-HQ anzubinden, stehen zwei Skripte zur Verfügung:

- **Task-Delegation (`delegate.sh`)**: Ermöglicht Claude das Delegieren von Aufgaben an Worker (`agy` oder `codex`) unter automatischem Senden von Lifecycle-Events (`TASK_HANDOVER`, `TASK_START`, `TASK_COMPLETE`, etc.) an das Dashboard.  
  👉 Siehe [delegate.md](file:///docs/development/delegate.md) für Installations- und Aufrufanleitung.

- **PR- & CI-Tracking (`hq-hook.sh`)**: Ein Claude-Code-Hook für `~/.claude/settings.json`, der `gh pr`-Befehle im Terminal überwacht und Lifecycle-Events (`DRAFT_PR_CREATED`, `REVIEW_START`, `PR_READY`, `CI_CHECK_PASS`, `MERGED`) an Agent-HQ meldet.  
  👉 Siehe [hq-hook.md](file:///docs/development/hq-hook.md) für die Registrierung in den Claude-Code-Settings.

---

## 5. Branching & Worktree-Strategie

Alle Features und Tickets werden über isolierte Git Worktrees bearbeitet:

```bash
git worktree add -b feat/<TICKET_ID>-<slug> .worktrees/feat-<TICKET_ID>-<slug> main
```
