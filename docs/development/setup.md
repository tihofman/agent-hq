# Entwicklungs-Setup & Grundlagen

Dieses Dokument beschreibt die Einrichtung der lokalen Umgebung, den Start von Agent-HQ, Konfigurationsoptionen und die Anbindung von Worker-Agenten.

---

## 1. Voraussetzungen

Folgende Werkzeuge müssen auf dem System installiert und im `PATH` verfügbar sein:

- **Node.js** (v24 oder neuer) inkl. **npm**
- **jq** (Kommandozeilen-JSON-Prozessor für Bash-Hooks und Skripte)
- **GitHub CLI (`gh`)** (für PR-, Check- und Workflow-Interaktionen)
- **git** (für Versionsverwaltung und Git Worktrees)

Optional (für Queue-Architektur V2 und Worker-Subagenten):

- **Docker** inkl. **Docker Compose** (für Redis 7 und optionales Bull-Board-Dashboard; ohne Docker startet Agent-HQ automatisch im V1-Modus)
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

1. Prüft alle erforderlichen Werkzeuge (`node`, `npm`, `jq`, `gh`, `lsof`).
2. Verifiziert, dass der konfigurierte Port frei ist. Ist der Port belegt, wird der belegende Prozess ausgegeben und das Skript bricht mit Exit-Code 1 ab.
3. Prüft, ob Docker läuft (`docker info`). Wenn ja, wird Redis per `docker compose up -d redis` gestartet und auf Bereitschaft gewartet (`PONG`). Ohne Docker wird eine Warnung auf stderr ausgegeben und der Server startet trotzdem (im V1-Modus ohne Queue-Funktionen).
4. Installiert Abhängigkeiten (`npm ci`), falls das Verzeichnis `node_modules` noch nicht existiert.
5. Baut die SvelteKit-Anwendung und startet den Server über `npx nx start agent-hq` auf `http://127.0.0.1:3333`.

### Startmodus: `--web` oder `--tui`

```bash
./run.sh --web                          # Server im Vordergrund, Bedienung über die Web-UI (wie oben)
AGENT_HQ_V2_WORKERS=1 ./run.sh --tui    # tmux-Sitzung mit TUI, Orchestrator und Server-Log
scripts/agent-hq --tui                  # dünner Wrapper, gleiche Optionen wie run.sh
```

Ohne Flag fragt `run.sh` nach dem Modus (`[w]eb / [t]ui`, Enter = Web). Ist stdin kein Terminal (CI, Skripte), gilt `--web`.

`--tui` ([ADR 0008](../adr/0008-tui-und-tmux-start.md)) braucht `tmux` (`brew install tmux` bzw. `sudo apt install tmux`) und `claude`. Der Befehl

1. hängt sich an eine laufende tmux-Sitzung `agent-hq` an, statt eine zweite zu starten,
2. führt `npm ci` aus, wenn `node_modules` fehlt, und baut die TUI, wenn `dist/apps/agent-hq-tui/main.js` fehlt,
3. nutzt einen laufenden Server, wenn `PORT` belegt ist und `/api/stream` antwortet. Ist der Port von einem anderen Prozess belegt, bricht er ab. Sonst startet er `run.sh --web` im tmux-Fenster `server`, reicht `PORT`, `HOST`, `PATH`, `AGENT_HQ_*` und `REDIS_*` durch und wartet, bis der Server antwortet,
4. baut das Fenster `hq` auf: links die TUI, rechts `claude` im Aufrufverzeichnis (normaler Berechtigungsmodus, ohne `--dangerously-skip-permissions`), unten `tail -F` auf das Server-Log (`AGENT_HQ_SERVER_LOG`, Standard `${TMPDIR:-/tmp}/agent-hq-server.log`),
5. weist darauf hin, wenn der Skill `agent-hq` in Claude Code fehlt (siehe Abschnitt 5). Installiert wird nichts.

Lösen mit `Ctrl-b d`, wieder anhängen mit `./run.sh --tui`. Server und Orchestrator laufen dabei weiter. `tmux kill-session -t agent-hq` beendet die Sitzung und stoppt einen von ihr gestarteten Server per SIGTERM. Ein schon vorher laufender Server bleibt unberührt, sein Log steht in dessen Terminal.

### Redis & Docker Compose (Queue-Architektur V2)

Für die V2-Queue-Architektur (BullMQ) wird Redis über Docker Compose (`docker-compose.yml`) bereitgestellt:

- **Redis**: Läuft auf `127.0.0.1:6379`, nutzt AOF-Persistenz (`--appendonly yes`) und speichert Daten im persistenten Docker-Volume `redis_data`.
- **Bull-Board**: Optionales Web-Dashboard zur Überwachung der Queues auf `http://127.0.0.1:3334` (hinter dem Compose-Profil `dev`).

```bash
# Redis manuell im Hintergrund starten
docker compose up -d redis

# Redis inklusive Bull-Board Web-Dashboard starten
docker compose --profile dev up -d

# Services stoppen (Daten im Volume bleiben erhalten)
docker compose down
```

### Entwicklungsserver (HMR / Hot Reload)

Für die aktive Frontend- und UI-Entwicklung wird der Vite-Entwicklungsserver verwendet:

```bash
npx nx serve agent-hq
```

Der Entwicklungsserver unterstützt schnelles Hot Module Replacement (HMR).

### Terminal-Dashboard (agent-hq-tui)

Als zweiter Client neben der Web-UI steht das Terminal-Dashboard `agent-hq-tui` (Ink) zur Verfügung:

```bash
# Bauen
npx nx run agent-hq-tui:build

# Starten (verbindet sich mit $AGENT_HQ_URL oder standardmäßig http://127.0.0.1:3333)
node dist/apps/agent-hq-tui/main.js
# oder
./apps/agent-hq-tui/bin/agent-hq-tui.js
```

Das Dashboard zeigt Projekte mit Queue-Zählern, Teams und Slots, laufende Jobs, Live-Logs, offene Rückfragen und Draft-PRs an.

**Tastenbelegung:**

- `↑ / ↓`: Navigation (Jobs und Rückfragen auswählen)
- `Enter`: Live-Log für ausgewählten Lauf öffnen
- `a`: Offene Rückfrage beantworten (Optionen oder Freitext)
- `k`: Lauf abbrechen (Kill Switch mit Bestätigung)
- `Tab` / `1-4`: Zwischen Ansichten wechseln
- `?`: Hilfe einblenden
- `q`: Beenden

### Tests & Qualitätssicherung

```bash
# Vitest Unit- und Integrationstests
npx nx test agent-hq

# Shell-Skript-Tests (inkl. run.sh, delegate.sh, hq-hook.sh)
for f in scripts/test/*.test.sh; do bash "$f" || exit 1; done

# Gesamte Validierungs-Pipeline (Lint, Test, Build, Typecheck)
npx nx run-many -t lint test build typecheck

# Code-Formatierung prüfen
npx nx format:check --all
```

---

## 3. Konfiguration & Umgebungsvariablen

Agent-HQ und seine Hilfsskripte können über Umgebungsvariablen gesteuert werden:

| Variable                 | Standardwert                          | Beschreibung                                                                                                                      |
| :----------------------- | :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `3333`                                | Port, auf dem der Agent-HQ-Server lauscht (z.B. `PORT=3482 ./run.sh`).                                                            |
| `HOST`                   | `127.0.0.1`                           | Bind-Adresse des Servers (standardmäßig nur localhost).                                                                           |
| `AGENT_HQ_URL`           | `http://127.0.0.1:3333`               | Basis-URL, die von Client-Skripten (`delegate.sh`, `hq-hook.sh`) zur Ingest-API aufgerufen wird.                                  |
| `AGENT_HQ_HOME`          | `~/.agent-hq`                         | Verzeichnis der Event-Historie (`history.jsonl`) und der Repo-Registry (`repos.json`).                                            |
| `AGENT_HQ_LOG_DIR`       | `${TMPDIR:-/tmp}/agent-hq`            | Verzeichnis, aus dem der Server Run-Logs liest. Muss zu `delegate.sh` passen, das immer nach `${TMPDIR:-/tmp}/agent-hq` schreibt. |
| `RUN_SH_DRY_RUN`         | `0`                                   | Wenn auf `1` gesetzt, führt `./run.sh` nur Pre-Flight-Prüfungen durch und beendet ohne Serverstart (genutzt in Tests).            |
| `AGENT_HQ_SERVER_LOG`    | `${TMPDIR:-/tmp}/agent-hq-server.log` | Server-Log der `--tui`-Sitzung (unteres Pane).                                                                                    |
| `RUN_SH_SERVER_ATTEMPTS` | `240`                                 | Versuche à 0,5 s, mit denen `--tui` auf `/api/stream` des selbst gestarteten Servers wartet.                                      |

---

## 4. Integration von `delegate.sh` und `hq-hook.sh`

Um Claude Code und Worker-Agenten an Agent-HQ anzubinden, stehen zwei Skripte zur Verfügung:

- **Task-Delegation (`delegate.sh`)**: Ermöglicht Claude das Delegieren von Aufgaben an Worker (`agy` oder `codex`) unter automatischem Senden von Lifecycle-Events (`TASK_HANDOVER`, `TASK_START`, `TASK_COMPLETE`, etc.) an das Dashboard.  
  👉 Siehe [delegate.md](delegate.md) für Installations- und Aufrufanleitung.

- **PR- & CI-Tracking (`hq-hook.sh`)**: Ein Claude-Code-Hook für `~/.claude/settings.json`, der `gh pr`-Befehle im Terminal überwacht und Lifecycle-Events (`DRAFT_PR_CREATED`, `REVIEW_START`, `PR_READY`, `CI_CHECK_PASS`, `MERGED`) an Agent-HQ meldet.  
  👉 Siehe [hq-hook.md](hq-hook.md) für die Registrierung in den Claude-Code-Settings.

---

## 5. Skill `agent-hq` für Claude Code installieren

Der Skill [`skills/agent-hq`](../../skills/agent-hq/SKILL.md) bringt Claude Code bei, Aufträge über die V2-Queue einzureihen, Rückfragen der Worker zu beantworten und Agent-HQ zu starten und zu prüfen.

> **Hinweis:** Das Repository `tihofman/agent-hq` ist privat. Für beide Wege brauchst du Lesezugriff auf das Repo und eine funktionierende Git-Authentifizierung für GitHub (z. B. `gh auth login` oder SSH-Key).

Variante A, über die [skills-CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add tihofman/agent-hq
```

Variante B, als Claude-Code-Plugin (in einer Claude-Code-Session):

```text
/plugin marketplace add tihofman/agent-hq
/plugin install agent-hq@agent-hq
```

Der Marketplace (`.claude-plugin/marketplace.json`) und das Plugin-Manifest (`.claude-plugin/plugin.json`) liegen im Repo-Root. Prüfen lassen sie sich mit `claude plugin validate . --strict`.

Der Skill steuert die Agent-HQ-Instanz unter `AGENT_HQ_URL` und schlägt vor, das aktuelle Repo zu registrieren, wenn es noch fehlt (siehe Abschnitt 6).

---

## 6. Weitere Repos registrieren (V2)

Eine Agent-HQ-Instanz kann Issues aus mehreren GitHub-Repos bearbeiten ([ADR-0007](../adr/0007-mehrere-repos.md)). Die Registry liegt in `$AGENT_HQ_HOME/repos.json`. Ist sie leer oder fehlt sie, bearbeitet Agent-HQ wie bisher nur das Repo, aus dem der Server läuft. Sobald ein Repo registriert ist, gilt nur noch die Registry. Registriere dann auch das Home-Repo, wenn es weiter bearbeitet werden soll.

```bash
HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
# Registrieren (Pfad = lokaler Klon mit GitHub-Remote)
curl -s -X POST "$HQ/api/repos" -H 'Content-Type: application/json' \
  -d '{"repo":"owner/name","path":"/abs/pfad/zum/klon"}'
# Auflisten
curl -s "$HQ/api/repos"
# Pausieren bzw. wieder aktivieren
curl -s -X PATCH "$HQ/api/repos/owner/name" -H 'Content-Type: application/json' -d '{"enabled":false}'
# Entfernen
curl -s -X DELETE "$HQ/api/repos/owner/name"
```

Beim Registrieren prüft der Server, dass der Pfad existiert, ein Git-Repo ist und `gh repo view` dort `owner/name` meldet. Danach legt er **auf GitHub** die Labels `team:*` und `status:*` an und trägt `.worktrees/` in `.git/info/exclude` des Repos ein. Mit `"enabled": false` bleibt ein Repo registriert, wird aber nicht mehr eingelesen. Der Ingest liest `repos.json` bei jedem Durchlauf neu, ein Neustart ist nicht nötig. Nur GitHub-Repos lassen sich registrieren, `local`-Repos nicht.

Registrierte Repos bekommen Worker mit weitreichenden Rechten. Registriere nur Repos, denen du vertraust. Laufende Jobs eines entfernten Repos schlagen fehl, statt im Home-Repo weiterzulaufen.

---

## 7. Branching & Worktree-Strategie

Alle Features und Tickets werden über isolierte Git Worktrees bearbeitet:

```bash
git worktree add -b feat/<TICKET_ID>-<slug> .worktrees/feat-<TICKET_ID>-<slug> main
```
