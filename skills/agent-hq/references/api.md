# Agent-HQ API-Referenz

Basis: `HQ="${AGENT_HQ_URL:-http://127.0.0.1:3333}"`. Alle Endpunkte liegen unter `apps/agent-hq/src/routes/api/`.

## Origin-Prüfung

`lib/server/origin.ts` (`isOriginAllowed`) gilt für alle Endpunkte außer `/api/stream`:

- Kein `Origin`-Header (CLI, `curl`): erlaubt.
- `Origin` mit Host `127.0.0.1` oder `localhost` **und** demselben Port wie der Server: erlaubt.
- Jeder andere oder ungültige `Origin`: `403 {"error":"Forbidden origin"}`.

## Endpunkte

| Methode | Pfad                         | Zweck                                                    |
| :------ | :--------------------------- | :------------------------------------------------------- |
| `GET`   | `/api/questions`             | offene Rückfragen (Status `PENDING`) aller Team-Queues   |
| `POST`  | `/api/questions`             | Rückfrage stellen (macht `scripts/hq-ask.sh`)            |
| `POST`  | `/api/questions/<id>/answer` | Rückfrage beantworten                                    |
| `GET`   | `/api/stream`                | SSE: `INIT_STATE` mit vollem Zustand, danach `UPDATE`    |
| `GET`   | `/api/history`               | die letzten 20 Runs aus `history.jsonl`                  |
| `GET`   | `/api/ticket?runId=<runId>`  | Titel und Akzeptanzkriterien des Tickets eines Runs      |
| `POST`  | `/api/events`                | Lifecycle-Event einliefern (`delegate.sh`, `hq-hook.sh`) |
| `POST`  | `/api/kill`                  | laufenden `delegate.sh`-Run abbrechen                    |

### `GET /api/questions`

```bash
curl -s "$HQ/api/questions"
```

Antwort `200`, JSON-Array:

```json
[
  {
    "id": "105-1",
    "issueId": 105,
    "team": "frontend",
    "question": "Welche Farbpalette soll als Default gesetzt werden?",
    "status": "PENDING",
    "options": ["System/Auto", "Dark", "Light"]
  }
]
```

Ohne V2 (kein Queue-Manager) ist die Antwort immer `[]`.

### `POST /api/questions/<id>/answer`

```bash
curl -s -X POST "$HQ/api/questions/105-1/answer" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg a "Dark" '{answer: $a}')"
```

| Code  | Bedeutung                                                             |
| :---- | :-------------------------------------------------------------------- |
| `200` | `{"ok":true}`, Job wird fortgesetzt, Issue zurück auf `status:queued` |
| `400` | ungültiges JSON, `answer` leer oder länger als 5000 Zeichen           |
| `403` | fremder `Origin`                                                      |
| `404` | ID nicht im Format `<issue>-<k>` oder keine passende Frage            |
| `409` | Frage schon beantwortet oder wird gerade beantwortet                  |

Belegt durch die Tests in `routes/api/questions/+server.test.ts` (GET ohne `Origin`) und `routes/api/questions/[id]/answer/+server.test.ts` (POST ohne `Origin`, 403 bei fremdem `Origin`).

### `POST /api/questions`

Body: `{"issueId": <n>, "team": "frontend|backend|qa", "question": "<≤2000 Zeichen>", "options": ["<≤200 Zeichen>", …]}` (höchstens 10 Optionen). `201` bei Erfolg. `409`, wenn für das Issue kein aktiver Job läuft. Danach steht das Issue auf `status:blocked`. Normalerweise ruft nur der Worker das über `scripts/hq-ask.sh` auf (siehe `docs/development/hq-ask.md`).

### `GET /api/stream`

```bash
curl -sN "$HQ/api/stream"
```

Erstes Event `INIT_STATE` mit `agents`, `runs`, `activePR`, `questions` und, nur wenn V2 läuft, `teams` (`idle` | `working` | `waiting_input` je Team). Danach kommt bei jeder Änderung `UPDATE` mit `{event, state}` und alle 30 s ein Heartbeat-Kommentar.

### `POST /api/kill`

Body: `{"runId": "<runId>", "message": "<optional, ≤4000 Zeichen>"}`. Nur für Runs im Status `handover` oder `running`. Beendet den Worker per SIGTERM und eskaliert nach 1,5 s zu SIGKILL. `202` bei Erfolg, `404` bei unbekanntem Run, `409` bei Konflikt.
