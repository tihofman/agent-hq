# Agent-HQ Betrieb

Alle Befehle laufen im Repo-Root des Servers (`<root>`).

## Start

```bash
AGENT_HQ_V2_WORKERS=1 ./run.sh
```

`run.sh`:

1. prüft `node`, `npm`, `jq`, `gh` und `lsof`,
2. bricht mit Exit 1 ab, wenn `PORT` (Standard `3333`) belegt ist,
3. startet Redis per `docker compose up -d redis` und wartet auf `PONG`. Ohne Docker gibt es nur eine Warnung, und der Server startet ohne V2,
4. führt `npm ci` aus, falls `node_modules` fehlt,
5. baut und startet den Server über `npx nx start agent-hq` (`node build` in `apps/agent-hq`) auf `http://$HOST:$PORT`.

Der Prozess läuft im Vordergrund. Starte ihn in einem eigenen Terminal oder als Hintergrund-Prozess. Server-Logs (`[issue-ingest]`, `[hooks]`, Worker-Fehler) stehen auf seiner Standardausgabe.

V2 läuft nur, wenn `AGENT_HQ_V2_WORKERS` den Wert `1` oder `true` hat **und** Redis beim Start erreichbar ist. Ist Redis nicht erreichbar, loggt der Server „Redis nicht erreichbar, V2 deaktiviert“ und läuft im V1-Modus weiter.

## Status

```bash
HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"
lsof -nP -iTCP:"${PORT:-3333}" -sTCP:LISTEN                      # läuft der Server?
curl -sN --max-time 2 "$HQ/api/stream" | head -n 2               # INIT_STATE; "teams" = V2 aktiv
docker compose exec -T redis redis-cli ping                       # PONG = Redis ok
gh issue list --label status:in-progress                          # laufende Aufträge
gh issue list --label status:blocked                              # Rückfragen oder Fehlschläge
```

Queues lassen sich optional im Bull-Board ansehen: `docker compose --profile dev up -d` startet es unter `http://127.0.0.1:3334`.

## Neustart

Nötig nach Merges, die Server-Code betreffen (`apps/agent-hq/**`, `libs/**`), und nach Änderungen an Umgebungsvariablen.

```bash
git pull --ff-only                                                # im Server-Checkout auf main
kill "$(lsof -t -nP -iTCP:"${PORT:-3333}" -sTCP:LISTEN)"
AGENT_HQ_V2_WORKERS=1 ./run.sh
```

Prüfe vorher mit `gh issue list --label status:in-progress`, ob gerade ein Worker läuft. Beim Stoppen beendet der Server laufende Worker-Prozesse (SIGTERM, nach 2 s SIGKILL). Starte deshalb möglichst neu, wenn kein Job aktiv ist. Die Jobs selbst liegen in Redis. Offene Rückfragen lädt der Server beim Start wieder aus Redis.

## Umgebungsvariablen

| Variable                             | Standard                     | Wirkung                                                             |
| :----------------------------------- | :--------------------------- | :------------------------------------------------------------------ |
| `PORT` / `HOST`                      | `3333` / `127.0.0.1`         | Bind-Adresse des Servers                                            |
| `AGENT_HQ_V2_WORKERS`                | _(leer)_                     | `1` oder `true` aktiviert Issue-Ingest und Worker-Pool              |
| `AGENT_HQ_URL`                       | `http://127.0.0.1:3333`      | Server-URL für `delegate.sh`, `hq-ask.sh` und `hq-hook.sh`          |
| `AGENT_HQ_HOME`                      | `~/.agent-hq`                | Verzeichnis der Event-Historie (`history.jsonl`)                    |
| `AGENT_HQ_LOG_DIR`                   | `${TMPDIR:-/tmp}/agent-hq`   | Run-Logs, aus denen der Server liest; muss zu `delegate.sh` passen  |
| `AGENT_HQ_ISSUE_POLL_INTERVAL_MS`    | `60000`                      | Abstand zwischen zwei Ingest-Durchläufen                            |
| `AGENT_HQ_QUESTION_GRACE_PERIOD_MS`  | `60000`                      | Wartezeit nach einer Rückfrage, bis der Worker beendet wird         |
| `AGENT_HQ_DELEGATE_SCRIPT`           | `<root>/scripts/delegate.sh` | anderes Delegations-Skript                                          |
| `REDIS_URL`                          | `redis://127.0.0.1:6379`     | Redis-Verbindung der Queues                                         |
| `AGENT_MODEL`, `AGENT_MODEL_<AGENT>` | _(leer)_                     | Modell für alle Worker bzw. pro Worker (z. B. `AGENT_MODEL_CLAUDE`) |

## Typische Fehler

| Symptom                                       | Ursache                                                                      | Lösung                                                                                       |
| :-------------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| `Fehler: Port 3333 ist bereits … belegt`      | alter Server oder anderer Dienst                                             | Prozess aus der Ausgabe beenden oder `PORT=3335 AGENT_HQ_URL=http://127.0.0.1:3335 ./run.sh` |
| `Warnung: Docker läuft nicht …`               | Docker Desktop aus                                                           | Docker starten, dann neu starten                                                             |
| `Redis nicht erreichbar, V2 deaktiviert`      | Redis-Container fehlt oder `REDIS_URL` falsch                                | `docker compose up -d redis`, `redis-cli ping`, dann neu starten                             |
| kein `teams` in `/api/stream`                 | `AGENT_HQ_V2_WORKERS` nicht gesetzt                                          | mit `AGENT_HQ_V2_WORKERS=1` neu starten                                                      |
| Issue bekommt kein `status:queued`            | kein oder falsches `team:*`, schon `status:*` gesetzt, Issue in anderem Repo | Labels korrigieren und 60 s warten                                                           |
| `status:blocked` ohne offene Frage            | Job nach 4 Versuchen fehlgeschlagen                                          | Server-Log und Run-Log in `AGENT_HQ_LOG_DIR` lesen, Ursache beheben                          |
| `curl: (7) Failed to connect` aus Claude Code | Claude-Sandbox blockiert `localhost`                                         | Befehl außerhalb der Sandbox ausführen                                                       |
| Worker-Lauf scheitert bei `git worktree add`  | Branch `feat/<n>-<slug>` ist anderswo ausgecheckt                            | eigenen Worktree entfernen oder detached auschecken                                          |

`PORT=3334` ist ungünstig, obwohl `run.sh` es vorschlägt: Dort läuft das Bull-Board aus dem Compose-Profil `dev`.
