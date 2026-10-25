# Agent-HQ API-Referenz

Basis: `HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"`. Alle Endpunkte liegen unter `apps/agent-hq/src/routes/api/`.

## Origin-Prüfung

`lib/server/origin.ts` (`isOriginAllowed`) gilt für alle Endpunkte außer `/api/stream`:

- Kein `Origin`-Header (CLI, `curl`): erlaubt.
- `Origin` mit Host `127.0.0.1` oder `localhost` **und** demselben Port wie der Server: erlaubt.
- Jeder andere oder ungültige `Origin`: `403 {"error":"Forbidden origin"}`.

## Endpunkte

| Methode  | Pfad                         | Zweck                                                    |
| :------- | :--------------------------- | :------------------------------------------------------- |
| `GET`    | `/api/questions`             | offene Rückfragen (Status `PENDING`) aller Team-Queues   |
| `POST`   | `/api/questions`             | Rückfrage stellen (macht `scripts/hq-ask.sh`)            |
| `POST`   | `/api/questions/<id>/answer` | Rückfrage beantworten                                    |
| `GET`    | `/api/repos`                 | registrierte Repos aus `repos.json`                      |
| `POST`   | `/api/repos`                 | Repo registrieren                                        |
| `PATCH`  | `/api/repos/<owner>/<name>`  | Repo aktivieren oder deaktivieren (`enabled`)            |
| `DELETE` | `/api/repos/<owner>/<name>`  | Repo aus der Registry entfernen                          |
| `GET`    | `/api/repos/stats`           | Home-Repo, Queue-Zähler und Draft-PRs je Repo            |
| `GET`    | `/api/stream`                | SSE: `INIT_STATE` mit vollem Zustand, danach `UPDATE`    |
| `GET`    | `/api/history`               | die letzten 20 Runs aus `history.jsonl`                  |
| `GET`    | `/api/ticket?runId=<runId>`  | Titel und Akzeptanzkriterien des Tickets eines Runs      |
| `POST`   | `/api/events`                | Lifecycle-Event einliefern (`delegate.sh`, `hq-hook.sh`) |
| `POST`   | `/api/kill`                  | laufenden `delegate.sh`-Run abbrechen                    |

### `GET /api/questions`

```bash
curl -s "$HQ/api/questions"
```

Antwort `200`, JSON-Array:

```json
[
  {
    "id": "acme.shop.105-1",
    "issueId": 105,
    "repo": "acme/shop",
    "team": "frontend",
    "question": "Welche Farbpalette soll als Default gesetzt werden?",
    "status": "PENDING",
    "options": ["System/Auto", "Dark", "Light"]
  }
]
```

Ohne V2 (kein Queue-Manager) ist die Antwort immer `[]`.

`repo` fehlt bei Jobs ohne Repo (leere Registry, Altbestand). Die ID ist dann `<issue>-<k>` (z. B. `105-1`), sonst `<owner>.<name>.<issue>-<k>` (Slash wird zu Punkt). `<k>` zählt die Rückfragen je Job hoch.

### `POST /api/questions/<id>/answer`

```bash
curl -s -X POST "$HQ/api/questions/acme.shop.105-1/answer" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg a "Dark" '{answer: $a}')"
```

| Code  | Bedeutung                                                             |
| :---- | :-------------------------------------------------------------------- |
| `200` | `{"ok":true}`, Job wird fortgesetzt, Issue zurück auf `status:queued` |
| `400` | ungültiges JSON, `answer` leer oder länger als 5000 Zeichen           |
| `403` | fremder `Origin`                                                      |
| `404` | ID nicht im Format `[<owner>.<name>.]<issue>-<k>` oder keine Frage    |
| `409` | Frage schon beantwortet oder wird gerade beantwortet                  |

Belegt durch die Tests in `routes/api/questions/+server.test.ts` (GET ohne `Origin`) und `routes/api/questions/[id]/answer/+server.test.ts` (POST ohne `Origin`, 403 bei fremdem `Origin`).

### `POST /api/questions`

Body: `{"issueId": <n>, "team": "frontend|backend|qa", "question": "<≤2000 Zeichen>", "options": ["<≤200 Zeichen>", …], "repo": "<owner>/<name>", "jobId": "<Job-ID>"}` (höchstens 10 Optionen; `repo` und `jobId` optional, ohne beide gilt das Home-Repo). `hq-ask.sh` setzt sie aus `HQ_REPO` und `HQ_JOB_ID`. `201` bei Erfolg. `409`, wenn für das Issue kein aktiver Job läuft. Danach steht das Issue auf `status:blocked`. Normalerweise ruft nur der Worker das über `scripts/hq-ask.sh` auf (siehe `docs/development/hq-ask.md`).

## Job-ID

Der Ingest legt je Issue genau einen Job an (`libs/queue/src/queues.ts`, `jobIdForIssue`):

- registriertes Repo: `<owner>/<name>#<n>`, z. B. `acme/shop#105`
- leere Registry (nur Home-Repo) und Altbestand: `issue-<n>`

Repo und Issue liest der Server aus den Job-Daten (`repo`, `issueId`), nicht aus der ID.

## Repos

Registry: `$AGENT_HQ_HOME/repos.json` (`lib/server/repos.ts`). Leere oder fehlende Registry heißt: nur das Home-Repo, aus dem der Server läuft. Mit mindestens einem Eintrag liest der Ingest nur noch die Einträge mit `enabled: true` ein, jeweils neu bei jedem Durchlauf.

### `GET /api/repos`

```bash
curl -s "$HQ/api/repos"
```

`200`, JSON-Array `[{"repo": "acme/shop", "path": "/abs/pfad/shop", "enabled": true}]`. `500`, wenn `repos.json` kein gültiges JSON-Array ist.

### `POST /api/repos`

```bash
curl -s -X POST "$HQ/api/repos" -H "Content-Type: application/json" \
  -d "$(jq -nc --arg r acme/shop --arg p /abs/pfad/shop '{repo: $r, path: $p}')"
```

Body: `repo` (`owner/name`), `path` (absolut), optional `enabled` (Standard `true`). Der Server prüft, dass `path` ein Verzeichnis in einem Git-Repo ist und `gh repo view` dort `repo` meldet (ohne Groß-/Kleinschreibung). Danach legt er auf GitHub alle `team:*`- und `status:*`-Labels an (`gh label create --force`) und trägt `.worktrees/` in `info/exclude` ein. Gespeichert werden der von `gh` gemeldete Name und der Git-Toplevel als `path`. Ein schon registriertes Repo wird ersetzt.

| Code  | Bedeutung                                                                                           |
| :---- | :-------------------------------------------------------------------------------------------------- |
| `201` | registrierter Eintrag `{repo, path, enabled}`                                                       |
| `400` | ungültiges JSON, `repo`/`path`/`enabled` ungültig, kein Git- oder GitHub-Repo, anderes `owner/name` |
| `403` | fremder `Origin`                                                                                    |
| `500` | z. B. `gh label create` gescheitert (fehlende Rechte); nichts registriert                           |

### `PATCH /api/repos/<owner>/<name>`

Body `{"enabled": true|false}`. `200` mit dem geänderten Eintrag, `400` bei ungültigem Namen oder `enabled`, `404` bei unbekanntem Repo. Ein deaktiviertes Repo bleibt registriert, wird aber nicht eingelesen.

### `DELETE /api/repos/<owner>/<name>`

`200 {"ok":true}`, `400` bei ungültigem Namen, `404` bei unbekanntem Repo. Laufende Jobs des Repos schlagen danach fehl, statt im Home-Repo weiterzulaufen.

### `GET /api/repos/stats`

`200 {"homeRepo": "<owner>/<name>"|null, "repos": [{repo, home, queues, draftPRs}]}`. `queues` zählt je Team `waiting`, `active`, `delayed`, `failed` (ohne V2 alles `0`). `draftPRs` sind offene Draft-PRs (`number`, `title`, `url`), 60 s gecacht. `homeRepo` ist `null`, wenn `gh` das Server-Repo nicht benennen kann.

Belegt durch `routes/api/repos/+server.test.ts` (POST ohne `Origin` → `201`, 403 bei fremdem `Origin`, 400 bei ungültiger Registrierung, PATCH, DELETE) und `routes/api/repos/stats/+server.test.ts`.

### `GET /api/stream`

```bash
curl -sN "$HQ/api/stream"
```

Erstes Event `INIT_STATE` mit `agents`, `runs`, `activePR`, `questions` und, nur wenn V2 läuft, `teams` (`idle` | `working` | `waiting_input` je Team). Danach kommt bei jeder Änderung `UPDATE` mit `{event, state}` und alle 30 s ein Heartbeat-Kommentar.

### `POST /api/kill`

Body: `{"runId": "<runId>", "message": "<optional, ≤4000 Zeichen>"}`. Nur für Runs im Status `handover` oder `running`. Beendet den Worker per SIGTERM und eskaliert nach 1,5 s zu SIGKILL. `202` bei Erfolg, `404` bei unbekanntem Run, `409` bei Konflikt.
