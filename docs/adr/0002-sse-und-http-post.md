# ADR 0002: SSE für Server→Browser, HTTP-POST für CLI→Server

## Status

Accepted (2026-10-22)

## Kontext

Events kommen aus Shell-Skripten (`delegate.sh`, `scripts/hq-hook.sh`) und müssen live im Browser erscheinen. Die Skripte dürfen den Terminal-Workflow nie blockieren, auch wenn Agent-HQ nicht läuft oder hängt. Der Browser empfängt fast ausschließlich Daten; seine wenigen Aktionen (z. B. Kill Switch) sind einzelne Requests. Nach einem Reload (F5) muss das Büro sofort den aktuellen Zustand zeigen.

## Entscheidung

- **CLI → Server**: `POST /api/events` mit JSON gemäß Event-Schema (PROJECT_PLAN 4C), per `curl --connect-timeout 0.1 --max-time 0.5 … || true`.
- **Server → Browser**: Server-Sent Events über `GET /api/stream`. Als erstes Event erhält jeder Client einen `INIT_STATE`-Snapshot.
- **Browser → Server**: einzelne HTTP-POSTs (z. B. `POST /api/kill`).
- Keine WebSockets.

## Konsequenzen

### Positiv

- `curl` reicht als Client, keine zusätzlichen Abhängigkeiten in den Skripten.
- Die Timeouts garantieren, dass `delegate.sh` und der Hook höchstens 0.5 s verlieren.
- SSE ist nativ (`EventSource`), reconnectet automatisch und läuft über normale SvelteKit-Routen ohne Upgrade-Handling.
- Mit `INIT_STATE` ist der Zustand nach jedem Reconnect vollständig.

### Negativ / Trade-offs

- SSE ist unidirektional; ein späterer Chat (Spike 6H) bräuchte zusätzliche POST-Endpunkte.
- Events, die während eines Server-Ausfalls gesendet werden, gehen verloren (bewusst akzeptiert zugunsten der Fehlertoleranz).
- POST-Endpunkte müssen den `Origin`-Header prüfen, da jeder lokale Browser-Tab `127.0.0.1` erreichen kann.
